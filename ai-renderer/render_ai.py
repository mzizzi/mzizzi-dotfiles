#!/usr/bin/env python3
import argparse
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from enum import StrEnum
import json
import ntpath
import os
from pathlib import Path, PureWindowsPath
import re
import shutil
import stat
import subprocess
import sys
import tempfile

from jinja2 import Environment, FileSystemLoader, StrictUndefined, TemplateError
import yaml


class Target(StrEnum):
    CLAUDE = "claude"
    PI = "pi"


class Layout(StrEnum):
    PROJECT = "project"
    PACKAGE = "package"


class CandidateStage(StrEnum):
    COMMIT = "commit"
    PUSH = "push"


class RenderError(ValueError):
    pass


class ResourceKind(StrEnum):
    SKILL = "skills"
    AGENT = "agents"


@dataclass(frozen=True)
class ResourceSource:
    namespace: str | None  # Source package namespace; absent for project skills.
    name: str  # Local resource name from its path.
    path: Path  # Entrypoint template; skill resources live beside it.
    kind: ResourceKind  # Skill bundle or agent definition.

    @property
    def identity(self):
        return self.name if self.namespace is None else f"{self.namespace}:{self.name}"


@dataclass(frozen=True)
class Artifact:
    content: bytes  # Exact output bytes.
    mode: int = 0o644  # File permissions copied from resources or set for generated text.


NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MARKER = ".ai-renderer-owned"
MARKER_CONTENT = {
    Layout.PACKAGE: b"AI resource renderer v1\n",
    Layout.PROJECT: b"AI project skills renderer v1\n",
}
TARGET_FIELDS = {
    Target.CLAUDE: {
        "disable-model-invocation": bool,
        "user-invocable": bool,
        "argument-hint": str,
        "allowed-tools": str,
    },
    Target.PI: {"disable-model-invocation": bool},
}

AGENT_FIELDS = {
    Target.CLAUDE: {"model": str, "effort": str, "experimental": dict},
    Target.PI: {
        "model": str, "thinking": str,
        "advertise": bool, "defaultContext": str, "systemPromptMode": str,
        "inheritProjectContext": bool, "inheritGlobalContext": bool, "inheritSkills": bool,
        "allowNestedSubagents": bool, "tools": str, "acceptanceRole": str,
    },
}
AGENT_CHOICES = {
    (Target.CLAUDE, "effort"): {"low", "medium", "high", "xhigh", "max"},
    (Target.PI, "thinking"): {"off", "minimal", "low", "medium", "high", "xhigh", "max"},
    (Target.PI, "defaultContext"): {"fresh", "fork"},
    (Target.PI, "systemPromptMode"): {"replace", "append"},
    (Target.PI, "acceptanceRole"): {"read-only", "writer"},
}
SKILL_ENTRYPOINT = "SKILL.md.j2"
MANIFEST = "manifest.yaml"
CLAUDE_MANIFEST_FIELDS = {"description": str, "dependencies": list}


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def unique_mapping(loader, node):
    result = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node)
        if not isinstance(key, str):
            raise RenderError("metadata keys must be strings")
        if key in result:
            raise RenderError(f"duplicate metadata key {key!r}")
        result[key] = loader.construct_object(value_node)
    return result


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, unique_mapping
)


def check_name(name):
    if len(name) > 64 or not NAME.fullmatch(name):
        raise RenderError(f"invalid skill, agent, or namespace name {name!r}")


def is_redirect(info):
    # Python 3.11 does not have Path.is_junction().
    return stat.S_ISLNK(info.st_mode) or bool(
        getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT
    )


def redirects(path):
    try:
        return is_redirect(path.lstat())
    except FileNotFoundError:
        return False


def skill_source(directory, namespace=None):
    if not directory.is_dir():
        raise RenderError(f"{directory}: expected a skill directory")
    path = directory / SKILL_ENTRYPOINT
    if not path.is_file():
        raise RenderError(f"{path}: missing {SKILL_ENTRYPOINT}")
    check_name(directory.name)
    return ResourceSource(namespace, directory.name, path, ResourceKind.SKILL)


def scan_tree(root, label):
    for path in sorted(root.iterdir()):
        info = path.lstat()
        if is_redirect(info):
            raise RenderError(f"{path}: {label} symlinks and junctions are not supported")
        if stat.S_ISDIR(info.st_mode):
            yield from scan_tree(path, label)
        yield path, info.st_mode


def discover(source, paths, layout):
    if layout == Layout.PROJECT:
        resources = [
            skill_source(path.parent) for path in paths
            if len(path.relative_to(source).parts) == 2 and path.match(SKILL_ENTRYPOINT)
        ]
        if not resources:
            raise RenderError(f"{source}: no project skill sources found (expected <name>/{SKILL_ENTRYPOINT})")
        return resources

    resources = []
    for kind in ResourceKind:
        for path in paths:
            if len(path.relative_to(source).parts) != 3 or not path.match(f"*/{kind}/*"):
                continue
            namespace = path.parent.parent.name
            check_name(namespace)
            if kind == ResourceKind.SKILL:
                resources.append(skill_source(path, namespace))
            else:
                if not path.is_file() or not path.name.endswith(".md.j2"):
                    raise RenderError(f"{path}: expected an agent .md.j2 file")
                name = path.name.removesuffix(".md.j2")
                check_name(name)
                resources.append(ResourceSource(namespace, name, path, kind))
    return resources


def render_frontmatter(metadata):
    # Pi's agent parser ignores indented plain-scalar continuations.
    flow_style = None if any(isinstance(value, dict) for value in metadata.values()) else False
    text = yaml.safe_dump(
        metadata, sort_keys=False, allow_unicode=True, width=float("inf"), default_flow_style=flow_style,
    )
    lines = text.splitlines()
    if len(lines) != len(metadata) or any(
        not line.startswith(f"{key}:") for key, line in zip(metadata, lines)
    ):
        raise RenderError("generated frontmatter must use one physical line per field")
    return text


def check_fields(block, fields, label):
    for key, value in block.items():
        expected = fields.get(key)
        if expected is None:
            raise RenderError(f"unsupported {label} metadata: {key}")
        if type(value) is not expected:
            raise RenderError(f"{label}.{key} must be {expected.__name__}")


def parse_resource(text, resource, target):
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise RenderError("expected YAML frontmatter")
    end = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
    if end is None:
        raise RenderError("missing closing frontmatter delimiter")
    metadata = yaml.load("".join(lines[1:end]), Loader=UniqueKeyLoader)
    if not isinstance(metadata, dict):
        raise RenderError("frontmatter must be a mapping")
    unknown = metadata.keys() - {"description", *Target}
    if unknown:
        raise RenderError(f"unsupported shared metadata: {', '.join(sorted(unknown))}")
    description = metadata.get("description")
    if not isinstance(description, str) or not description.strip() or len(description) > 1024:
        raise RenderError("description must be nonempty text of at most 1024 characters")
    fields = TARGET_FIELDS if resource.kind == ResourceKind.SKILL else AGENT_FIELDS
    for metadata_target in Target:
        block = metadata.get(metadata_target, {})
        if block is False:
            continue
        if not isinstance(block, dict):
            raise RenderError(f"{metadata_target} metadata must be a mapping")
        check_fields(block, fields[metadata_target], metadata_target)
        for key, value in block.items():
            if resource.kind == ResourceKind.AGENT:
                if key == "experimental":
                    if value.keys() != {"cacheTtl"} or not isinstance(value["cacheTtl"], str) or not value["cacheTtl"].strip():
                        raise RenderError("claude.experimental must contain only a nonempty cacheTtl string")
                choices = AGENT_CHOICES.get((metadata_target, key))
                if choices is not None and value not in choices:
                    raise RenderError(f"{metadata_target}.{key} must be one of {', '.join(sorted(choices))}")
                if type(value) is str and not value.strip():
                    raise RenderError(f"{metadata_target}.{key} must be nonempty text")
    if metadata.get(target) is False:
        return None
    output_metadata = {"name": resource.name, "description": description}
    if resource.kind == ResourceKind.AGENT and target == Target.PI:
        output_metadata["package"] = resource.namespace
    output_metadata.update(metadata.get(target, {}))
    frontmatter = render_frontmatter(output_metadata)
    body = "".join(lines[end + 1:])
    return f"---\n{frontmatter}---\n{body}".rstrip("\n") + "\n"


def load_claude_manifest(path):
    try:
        metadata = yaml.load(path.read_text(encoding="utf-8"), Loader=UniqueKeyLoader)
        if not isinstance(metadata, dict):
            raise RenderError("manifest must be a mapping")
        unknown = metadata.keys() - {Target.CLAUDE}
        if unknown:
            raise RenderError(f"unsupported manifest metadata: {', '.join(sorted(unknown))}")
        claude = metadata.get(Target.CLAUDE, {})
        if not isinstance(claude, dict):
            raise RenderError("claude manifest metadata must be a mapping")
        check_fields(claude, CLAUDE_MANIFEST_FIELDS, "claude manifest")
        for key, value in claude.items():
            if type(value) is str and not value.strip():
                raise RenderError(f"claude.{key} must be nonempty text")
        for dependency in claude.get("dependencies", []):
            if not isinstance(dependency, dict) or dependency.keys() != {"name", "marketplace"}:
                raise RenderError("claude.dependencies entries must map name and marketplace to nonempty text")
            if not all(isinstance(value, str) and value.strip() for value in dependency.values()):
                raise RenderError("claude.dependencies entries must map name and marketplace to nonempty text")
    except (RenderError, yaml.YAMLError, UnicodeError) as error:
        raise RenderError(f"{path}: {error}") from error
    return claude


def output_name(resource, target):
    if target == Target.CLAUDE:
        return resource.identity
    if resource.kind == ResourceKind.AGENT:
        return f"{resource.namespace}.{resource.name}"
    return resource.name


def package_path(target, namespace):
    return Path("plugins" if target == Target.CLAUDE else "packages") / namespace


def bundle_files(paths, resources):
    bundles = {resource.path.parent: [] for resource in resources if resource.kind == ResourceKind.SKILL}
    for path, mode in paths.items():
        if stat.S_ISDIR(mode):
            continue
        for parent in path.parents:
            if parent in bundles:
                bundles[parent].append((path, mode))
                break
    return bundles


def package_manifests(included, manifests, target):
    for namespace in sorted({resource.namespace for resource in included}):
        package = package_path(target, namespace)
        if target == Target.CLAUDE:
            path = package / ".claude-plugin/plugin.json"
            manifest = {"name": namespace, **manifests.get(namespace, {})}
        else:
            path = package / "package.json"
            pi = {}
            kinds = {resource.kind for resource in included if resource.namespace == namespace}
            if ResourceKind.SKILL in kinds:
                pi["skills"] = ["./skills"]
            if ResourceKind.AGENT in kinds:
                pi["subagents"] = {"agents": ["./agents"]}
            manifest = {"name": f"{namespace}-ai", "pi": pi}
        yield path, Artifact((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))


def render_target(source, paths, bundles, resources, manifests, target, models, layout):
    environment = Environment(
        loader=FileSystemLoader(source),
        undefined=StrictUndefined,
        autoescape=False,
        keep_trailing_newline=True,
    )
    artifacts = {}
    output_dirs = {}
    names = set()
    included = set()
    references = set()

    def add(path, artifact):
        check_windows_path(path, "output")
        key = path.as_posix().casefold()
        if key in artifacts:
            raise RenderError(f"duplicate output destination: {path}")
        if key in output_dirs:
            raise RenderError(f"file/directory output collision: {path}")
        for parent in path.parents:
            spelling = parent.as_posix()
            parent_key = spelling.casefold()
            if parent_key in artifacts:
                raise RenderError(f"duplicate output destination: {path}")
            if output_dirs.setdefault(parent_key, spelling) != spelling:
                raise RenderError(f"case-aliased output directory: {parent}")
        artifacts[key] = path, artifact

    add(Path(MARKER), Artifact(MARKER_CONTENT[layout]))
    for resource in resources.values():
        kind = resource.kind
        destination = Path() if resource.namespace is None else package_path(target, resource.namespace) / kind
        if kind == ResourceKind.SKILL:
            destination /= resource.name

        def reference(identity, reference_kind):
            label = "skill" if reference_kind == ResourceKind.SKILL else "agent"
            helper = "Skill" if reference_kind == ResourceKind.SKILL else "Agent"
            if not isinstance(identity, str):
                raise RenderError(f"{helper}() needs a string identity")
            qualified = identity
            if resource.namespace is not None and ":" not in identity:
                qualified = f"{resource.namespace}:{identity}"
            referenced = resources.get((reference_kind, qualified))
            if referenced is None:
                raise RenderError(f"unknown {label} {identity!r}")
            references.add((resource, referenced))
            return f"the `{output_name(referenced, target)}` {label}"

        def render_template(path):
            template = environment.get_template(path.relative_to(source).as_posix())
            return template.render(
                target=target,
                models=models,
                Skill=lambda identity: reference(identity, ResourceKind.SKILL),
                Agent=lambda identity: reference(identity, ResourceKind.AGENT),
            )

        try:
            entry = parse_resource(render_template(resource.path), resource, target)
        except (RenderError, TemplateError, yaml.YAMLError, UnicodeError) as error:
            raise RenderError(f"{resource.path}: {target}: {error}") from error
        if entry is None:
            continue
        included.add(resource)
        name = output_name(resource, target)
        if (kind, name) in names:
            raise RenderError(f"{resource.path}: {target}: output name collision: {resource.name}")
        names.add((kind, name))

        files = bundles[resource.path.parent] if kind == ResourceKind.SKILL else [(resource.path, paths[resource.path])]
        for path, mode in files:
            relative = path.relative_to(resource.path.parent)
            if relative.parts[0] == "_templates":
                continue
            try:
                mode = stat.S_IMODE(mode)
                if path.suffix == ".j2":
                    relative = relative.with_suffix("")
                    text = entry if path == resource.path else render_template(path)
                    artifact = Artifact((text.rstrip("\n") + "\n").encode("utf-8"), mode)
                else:
                    artifact = Artifact(path.read_bytes(), mode)
                add(destination / relative, artifact)
            except (RenderError, TemplateError, yaml.YAMLError, UnicodeError) as error:
                raise RenderError(f"{path}: {target}: {error}") from error
    for caller, referenced in sorted(references, key=lambda pair: (pair[0].identity, pair[1].identity)):
        if caller in included and referenced not in included:
            raise RenderError(f"{caller.path}: {target}: reference to excluded resource {referenced.identity!r}")
    if layout == Layout.PACKAGE:
        for path, artifact in package_manifests(included, manifests, target):
            add(path, artifact)
    return dict(artifacts.values())


def check_windows_path(path, label):
    if not isinstance(path, PureWindowsPath):
        return

    def reserved(part):
        if hasattr(ntpath, "isreserved"):
            return ntpath.isreserved(part)
        return part.endswith((".", " ")) or ":" in part or PureWindowsPath(part).is_reserved()

    if (path.drive and not path.root) or path.drive.startswith(("\\\\?\\", "\\\\.\\")) or any(
        reserved(part) for part in path.parts if part not in (path.anchor, "..")
    ):
        raise RenderError(f"{path}: ambiguous Windows {label} path")


def resolve_output(path):
    check_windows_path(path, "output")
    path = path.absolute()
    # Resolving first can hide a linked output ancestor.
    for component in (*reversed(path.parents), path):
        if redirects(component):
            raise RenderError(f"{component}: output symlinks and junctions are not supported")
    return path.resolve()


def contains_tree(root, path):
    if path.is_relative_to(root):
        return True
    try:
        root_stat = root.stat()
    except FileNotFoundError:
        return False
    # Real paths can still differ on case-insensitive filesystems and aliased mounts.
    if not root_stat.st_ino:
        return False
    for ancestor in (path, *path.parents):
        try:
            if os.path.samestat(root_stat, ancestor.stat()):
                return True
        except FileNotFoundError:
            continue
    return False


def check_owned(destination, layout):
    if not destination.exists():
        return set()
    if not destination.is_dir():
        raise RenderError(f"{destination}: output must be a directory")
    marker = destination / MARKER
    if any(destination.iterdir()) and (
        redirects(marker) or not marker.is_file() or marker.read_bytes() != MARKER_CONTENT[layout]
    ):
        raise RenderError(f"{destination}: unowned output (expected {layout} marker at {marker})")
    return {path.relative_to(destination) for path, mode in scan_tree(destination, "output") if stat.S_ISREG(mode)}


def differences(destination, artifacts, actual):
    changes = []
    for path in sorted(artifacts.keys() | actual):
        full_path = destination / path
        if path not in artifacts:
            changes.append(f"stale: {full_path}")
        elif path not in actual:
            changes.append(f"missing: {full_path}")
        elif full_path.read_bytes() != artifacts[path].content or (
            sys.platform != "win32" and stat.S_IMODE(full_path.stat().st_mode) != artifacts[path].mode
        ):
            changes.append(f"changed: {full_path}")
    return changes


def publish(destination, artifacts):
    temporary = Path(tempfile.mkdtemp(prefix=".ai-render-", dir=destination.parent))
    preserve_backup = False
    try:
        staging = temporary / "new"
        staging.mkdir()
        for path, artifact in artifacts.items():
            output = staging / path
            try:
                output.parent.mkdir(parents=True, exist_ok=True)
                with output.open("xb") as handle:
                    handle.write(artifact.content)
            except FileExistsError as error:
                raise RenderError(f"duplicate output destination: {path}") from error
            output.chmod(artifact.mode)
        backup = temporary / "old"
        existed = destination.exists()
        if existed:
            destination.rename(backup)
        try:
            staging.rename(destination)
        except OSError:
            if existed:
                try:
                    backup.rename(destination)
                except OSError as recovery_error:
                    preserve_backup = True
                    raise RenderError(
                        f"{destination}: replacement and recovery failed; previous output remains at {backup}"
                    ) from recovery_error
            raise
    finally:
        if not preserve_backup:
            shutil.rmtree(temporary)


def build_targets(
    source: Path, destinations: Mapping[Target, Path], *, layout: Layout, check: bool = False,
) -> list[str]:
    check_windows_path(source, "input")
    if redirects(source) or not source.is_dir():
        raise RenderError(f"{source}: source must be a real directory")
    source = source.resolve(strict=True)
    destinations = {target: resolve_output(path) for target, path in destinations.items()}
    actual = {}
    for target, destination in destinations.items():
        if contains_tree(source, destination) or contains_tree(destination, source):
            raise RenderError(f"{source} and {destination}: input and output trees must not overlap")
        for previous in actual:
            other = destinations[previous]
            if contains_tree(other, destination) or contains_tree(destination, other):
                raise RenderError(f"{other} and {destination}: output trees must not overlap")
        actual[target] = check_owned(destination, layout)
    paths = dict(sorted(scan_tree(source, "source")))
    resources = {(resource.kind, resource.identity): resource for resource in discover(source, paths, layout)}
    bundles = bundle_files(paths, resources.values())
    manifests = {}
    models = {}
    if layout == Layout.PACKAGE:
        manifests = {
            path.parent.name: load_claude_manifest(path) for path in paths
            if len(path.relative_to(source).parts) == 2 and path.match(MANIFEST)
        }
        models = json.loads((source / "models.json").read_text(encoding="utf-8"))
    rendered = {
        target: render_target(source, paths, bundles, resources, manifests, target, models, layout)
        for target in destinations
    }
    if check:
        return [
            change
            for target, destination in destinations.items()
            for change in differences(destination, rendered[target], actual[target])
        ]
    for target, destination in destinations.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        publish(destination, rendered[target])
    return []


def build(repo_root, targets=tuple(Target), check=False):
    return build_targets(
        repo_root / "ai", {target: repo_root / "ai-rendered" / target for target in targets},
        layout=Layout.PACKAGE, check=check,
    )


DOTFILES_CANDIDATE_PATHS = (
    "ai/", "ai-rendered/", "ai-renderer/render_ai.py", "ai-renderer/requirements.txt",
    ".pre-commit-config.yaml", ".prettierrc", ".prettierignore", ".markdownlint-cli2.yaml",
    ".gitattributes", ".gitignore",
)


def git_records(repo_root: Path, *args: str) -> list[str]:
    command = ["git", "--no-optional-locks", "-c", "diff.autoRefreshIndex=false"]
    if sys.platform != "win32":
        command += ["-c", "core.filemode=true"]
    result = subprocess.run([*command, *args], cwd=repo_root, capture_output=True)
    if result.returncode:
        detail = os.fsdecode(result.stderr).strip()
        raise RenderError(f"Git candidate check failed ({' '.join(args[:2])}): {detail}")
    return [os.fsdecode(item) for item in result.stdout.split(b"\0") if item]


def check_git_state(repo_root: Path, stage: CandidateStage) -> list[str]:
    errors = []
    for entry in git_records(repo_root, "ls-files", "-v", "-z", "--", *DOTFILES_CANDIDATE_PATHS):
        flag, path = entry[0], entry[2:]
        if flag.islower() or flag.upper() == "S":
            errors.append(
                f"{path!r}: unsupported assume-unchanged/skip-worktree index flag; "
                "clear it with git update-index --no-assume-unchanged --no-skip-worktree -- <path>"
            )
    for path in git_records(repo_root, "ls-files", "--others", "-z", "--", *DOTFILES_CANDIDATE_PATHS):
        errors.append(f"{path!r}: untracked AI file (including ignored files); stage the intended file or remove it")
    # Unlike --name-only, --numstat compares content even when stat data is stale,
    # without needing to refresh the index. Disable renames for one path per record.
    diff_options = ("--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z")
    for entry in git_records(repo_root, "diff", *diff_options, "--", *DOTFILES_CANDIDATE_PATHS):
        path = entry.split("\t", 2)[2]
        errors.append(f"{path!r}: relevant worktree file differs from the index; stage or restore it before checking")
    if stage == CandidateStage.PUSH:
        for entry in git_records(repo_root, "diff", "--cached", *diff_options, "HEAD", "--", *DOTFILES_CANDIDATE_PATHS):
            path = entry.split("\t", 2)[2]
            errors.append(f"{path!r}: push candidate differs from HEAD; commit the intended source and output before pushing")
    return errors


def check_candidate(repo_root: Path, stage: CandidateStage) -> int:
    errors = check_git_state(repo_root, stage)
    if not errors:
        errors = build(repo_root, check=True)
        if errors:
            errors.append(
                "Render the packages as shown in ai-renderer/README.md, then review and stage the intended source and output."
            )
    if errors:
        print("AI candidate check failed:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    print("AI candidate and rendered output are current.")
    return 0


def path_arg(value):
    if not value:
        raise argparse.ArgumentTypeError("path must not be empty")
    return Path(value)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Render native project skills or AI packages for Claude and Pi.",
        epilog="Pass --input, --output, and --target together for an explicit build. "
               "Without path or layout options, build packages in the checkout that contains this script.",
    )
    parser.add_argument("--input", type=path_arg, help="Source directory, relative to the working directory unless absolute.")
    parser.add_argument("--output", type=path_arg, help="Exact generated directory, relative to the working directory unless absolute.")
    parser.add_argument("--target", type=Target, choices=list(Target), help="Target harness (both in a default package build).")
    parser.add_argument("--layout", type=Layout, choices=list(Layout), help="Source and output layout (project for explicit paths unless specified).")
    parser.add_argument("--check", action="store_true", help="Report missing, changed, or stale output without writes or Git checks.")
    parser.add_argument(
        "--check-candidate", type=CandidateStage, choices=list(CandidateStage),
        help="Check the dotfiles package candidate against the Git index (and HEAD for push). Use on its own.",
    )
    args = parser.parse_args(argv)
    explicit = args.input is not None or args.output is not None or args.layout is not None
    if args.check_candidate is not None and (explicit or args.target is not None or args.check):
        parser.error("--check-candidate cannot be combined with --input, --output, --layout, --target, or --check")
    if explicit and (args.input is None or args.output is None or args.target is None):
        parser.error("explicit rendering requires --input, --output, and --target together")
    try:
        if explicit:
            changes = build_targets(
                args.input, {args.target: args.output}, layout=args.layout or Layout.PROJECT, check=args.check,
            )
        else:
            repo_root = Path(__file__).resolve().parent.parent
            if args.check_candidate is not None:
                return check_candidate(repo_root, args.check_candidate)
            changes = build(repo_root, targets=(args.target,) if args.target else tuple(Target), check=args.check)
    except (RenderError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if changes:
        print("\n".join(changes))
        return 1
    print("AI output is current." if args.check else "Rendered AI resources.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
