#!/usr/bin/env python3
import argparse
from dataclasses import dataclass
from enum import StrEnum
import json
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile

from jinja2 import Environment, FileSystemLoader, StrictUndefined, TemplateError
import yaml


class Target(StrEnum):
    CLAUDE = "claude"
    PI = "pi"


class RenderError(ValueError):
    pass


@dataclass(frozen=True)
class SkillSource:
    namespace: str  # Source package namespace.
    name: str  # Local skill name from its directory.
    directory: Path  # Source bundle, including supporting files.

    @property
    def identity(self):
        return f"{self.namespace}:{self.name}"


@dataclass(frozen=True)
class Artifact:
    content: bytes  # Exact output bytes.
    mode: int = 0o644  # File permissions copied from resources or set for generated text.


NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MARKER = ".ai-renderer-owned"
MARKER_CONTENT = b"AI resource renderer v1\n"
TARGET_FIELDS = {
    Target.CLAUDE: {
        "disable-model-invocation": bool,
        "user-invocable": bool,
        "argument-hint": str,
    },
    Target.PI: {"disable-model-invocation": bool},
}


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
        raise RenderError(f"invalid skill or namespace name {name!r}")


def discover(source):
    if not source.is_dir() or source.is_symlink():
        raise RenderError(f"{source}: source must be a real directory")
    for path in source.rglob("*"):
        if path.is_symlink():
            raise RenderError(f"{path}: source symlinks are not supported")
    skills = {}
    for directory in sorted(source.glob("*/skills/*")):
        if not directory.is_dir():
            raise RenderError(f"{directory}: expected a skill directory")
        namespace = directory.parent.parent.name
        name = directory.name
        check_name(namespace)
        check_name(name)
        if not (directory / "SKILL.md.j2").is_file():
            raise RenderError(f"{directory}: missing SKILL.md.j2")
        skill = SkillSource(namespace, name, directory)
        skills[skill.identity] = skill
    return skills


def parse_skill(text, skill, target):
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
    for metadata_target in Target:
        block = metadata.get(metadata_target, {})
        if not isinstance(block, dict):
            raise RenderError(f"{metadata_target} metadata must be a mapping")
        for key, value in block.items():
            expected = TARGET_FIELDS[metadata_target].get(key)
            if expected is None:
                raise RenderError(f"unsupported {metadata_target} metadata: {key}")
            if type(value) is not expected:
                raise RenderError(f"{metadata_target}.{key} must be {expected.__name__}")
    name = skill.name
    check_name(name)
    output_metadata = {"name": name, "description": description, **metadata.get(target, {})}
    frontmatter = yaml.safe_dump(output_metadata, sort_keys=False, allow_unicode=True)
    body = "".join(lines[end + 1:])
    return f"---\n{frontmatter}---\n{body}".rstrip("\n") + "\n"


def render_target(source, skills, target):
    environment = Environment(
        loader=FileSystemLoader(source),
        undefined=StrictUndefined,
        autoescape=False,
        keep_trailing_newline=True,
    )
    artifacts = {Path(MARKER): Artifact(MARKER_CONTENT)}
    names = set()

    def add(path, artifact):
        if path in artifacts or any(parent in artifacts for parent in path.parents):
            raise RenderError(f"duplicate output destination: {path}")
        if any(path in existing.parents for existing in artifacts):
            raise RenderError(f"file/directory output collision: {path}")
        artifacts[path] = artifact

    for skill in skills.values():
        name = skill.name
        identity = skill.identity if target == Target.CLAUDE else name
        if identity in names:
            raise RenderError(f"{skill.directory}: {target}: output name collision: {name}")
        names.add(identity)
        if target == Target.CLAUDE:
            package = Path("plugins") / skill.namespace
        else:
            package = Path("packages") / skill.namespace
        destination = package / "skills" / name

        def skill_reference(identity):
            if not isinstance(identity, str):
                raise RenderError("Skill() needs a string identity")
            qualified = identity if ":" in identity else f"{skill.namespace}:{identity}"
            referenced = skills.get(qualified)
            if referenced is None:
                raise RenderError(f"unknown skill {identity!r}")
            reference = referenced.identity if target == Target.CLAUDE else referenced.name
            return f"the `{reference}` skill"

        for path in sorted(skill.directory.rglob("*")):
            if path.is_dir():
                continue
            relative = path.relative_to(skill.directory)
            try:
                mode = stat.S_IMODE(path.stat().st_mode)
                if path.suffix == ".j2":
                    relative = relative.with_suffix("")
                    template = environment.get_template(path.relative_to(source).as_posix())
                    text = template.render(Skill=skill_reference)
                    if path == skill.directory / "SKILL.md.j2":
                        text = parse_skill(text, skill, target)
                    artifact = Artifact((text.rstrip("\n") + "\n").encode("utf-8"), mode)
                else:
                    artifact = Artifact(path.read_bytes(), mode)
                add(destination / relative, artifact)
            except (RenderError, TemplateError, yaml.YAMLError, UnicodeError) as error:
                raise RenderError(f"{path}: {target}: {error}") from error
    for namespace in sorted({skill.namespace for skill in skills.values()}):
        if target == Target.CLAUDE:
            path = Path("plugins") / namespace / ".claude-plugin/plugin.json"
            manifest = {"name": namespace}
        else:
            path = Path("packages") / namespace / "package.json"
            manifest = {"name": f"{namespace}-ai", "pi": {"skills": ["./skills"]}}
        add(path, Artifact((json.dumps(manifest, indent=2) + "\n").encode("utf-8")))
    return artifacts


def check_owned(destination):
    if destination.is_symlink():
        raise RenderError(f"{destination}: output symlinks are not supported")
    if not destination.exists():
        return
    if not destination.is_dir():
        raise RenderError(f"{destination}: output must be a directory")
    marker = destination / MARKER
    if any(destination.iterdir()) and (
        marker.is_symlink() or not marker.is_file() or marker.read_bytes() != MARKER_CONTENT
    ):
        raise RenderError(f"{destination}: refusing to replace unowned output")
    for path in destination.rglob("*"):
        if path.is_symlink():
            raise RenderError(f"{path}: output symlinks are not supported")


def differences(destination, artifacts):
    actual = {path.relative_to(destination) for path in destination.rglob("*") if path.is_file()}
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
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(artifact.content)
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


def build(repo_root, targets=tuple(Target), check=False):
    source = repo_root / "ai"
    output = repo_root / "generated"
    if output.is_symlink():
        raise RenderError(f"{output}: output symlinks are not supported")
    skills = discover(source)
    rendered = {target: render_target(source, skills, target) for target in targets}
    for target in targets:
        check_owned(output / target)
    if check:
        return [
            change
            for target in targets
            for change in differences(output / target, rendered[target])
        ]
    output.mkdir(exist_ok=True)
    for target in targets:
        publish(output / target, rendered[target])
    return []


def main():
    parser = argparse.ArgumentParser(description="Render AI skills for Claude plugins and Pi packages.")
    parser.add_argument("--target", type=Target, choices=list(Target), help="Render only this target; otherwise render both.")
    parser.add_argument("--check", action="store_true", help="Report missing, changed, or stale output without writes.")
    args = parser.parse_args()
    try:
        changes = build(
            Path(__file__).resolve().parent.parent,
            targets=(args.target,) if args.target else tuple(Target),
            check=args.check,
        )
    except (RenderError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if changes:
        print("\n".join(changes))
        return 1
    print("AI output is current." if args.check else "Rendered AI skills.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
