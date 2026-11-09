from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

from test_pilot_skills import REPO
from render_ai import build


PRETTIER = "prettier-ai-rendered"
MARKDOWNLINT = "markdownlint-ai-rendered"
VENDORED = {
    Path(f"ai-rendered/{target}/{kind}/mzizzi/skills/adversarial-review/references/adversarial-review.md")
    for target, kind in (("claude", "plugins"), ("pi", "packages"))
}


class MarkdownCheckTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pre_commit = shutil.which("pre-commit")
        if cls.pre_commit is None:
            raise RuntimeError("Markdown acceptance tests require pre-commit and Node >=22; install them and retry.")

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ai-markdown-checks-")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        for name in (".pre-commit-config.yaml", ".prettierrc", ".prettierignore", ".markdownlint-cli2.yaml"):
            shutil.copy2(REPO / name, self.repo / name)
        subprocess.run(["git", "init", str(self.repo)], check=True, capture_output=True)
        (self.repo / "selected.py").write_text("# Only a non-Markdown file is selected.\n")
        # Explicit tool scope must not silently defer to Git's ignore rules.
        (self.repo / ".gitignore").write_text("ai-rendered/\n")
        build(self.repo)

    def output_bytes(self):
        return {
            path.relative_to(self.repo): path.read_bytes()
            for path in (self.repo / "ai-rendered").rglob("*") if path.is_file()
        }

    def run_hook(self, hook, *, config=".pre-commit-config.yaml", stage="pre-commit", files=("selected.py",)):
        before = self.output_bytes()
        result = subprocess.run(
            [self.pre_commit, "run", hook, "--config", config, "--hook-stage", stage,
             "--verbose", "--color", "never", "--files", *files],
            cwd=self.repo, capture_output=True, text=True,
        )
        self.assertEqual(self.output_bytes(), before, "Markdown checks must never rewrite output")
        return result.returncode, result.stdout + result.stderr

    def assert_hooks_pass(self, *, stage="pre-commit"):
        for hook in (PRETTIER, MARKDOWNLINT):
            with self.subTest(hook=hook, stage=stage):
                code, output = self.run_hook(hook, stage=stage)
                self.assertEqual(code, 0, output)
                self.assertNotIn("Skipped", output)

    def write_output(self, relative, content):
        path = self.repo / "ai-rendered/pi/packages/mzizzi" / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
        return path.relative_to(self.repo).as_posix()

    def test_real_corpus_passes_both_stages_without_changing_bytes_or_frontmatter(self):
        before = self.output_bytes()
        markdown = {path: content for path, content in before.items() if path.suffix == ".md"}
        self.assertEqual(len(markdown), 71)
        vendor = (REPO / "ai/mzizzi/skills/adversarial-review/references/adversarial-review.md").read_bytes()
        for path in VENDORED:
            self.assertEqual(before[path], vendor)
        for path, content in markdown.items():
            if path.name == "SKILL.md" or path.parent.name == "agents":
                frontmatter = content.decode().split("---", 2)[1].strip().splitlines()
                metadata = yaml.safe_load("\n".join(frontmatter))
                self.assertEqual(len(frontmatter), len(metadata), str(path))
                for line, key in zip(frontmatter, metadata):
                    self.assertTrue(line.startswith(f"{key}:"), (path, line))
        self.assertTrue(any(len(line) > 80 for content in markdown.values() for line in content.splitlines()))
        self.assert_hooks_pass()
        self.assert_hooks_pass(stage="pre-push")
        self.assertEqual(self.output_bytes(), before)
        self.assertEqual(build(self.repo, check=True), [])

    def test_each_non_exempt_file_is_checked_with_only_a_python_file_selected(self):
        checked = sorted(path for path in self.output_bytes() if path.suffix == ".md" and path not in VENDORED)
        self.assertEqual(len(checked), 69)
        before = self.output_bytes()
        for path in checked:
            (self.repo / path).write_bytes(before[path] + b"\n\n\n")
        code, output = self.run_hook(PRETTIER)
        self.assertNotEqual(code, 0, output)
        for path in checked:
            self.assertIn(path.as_posix(), output)
        for path in VENDORED:
            self.assertNotIn(f"[warn] {path.as_posix()}", output)
        for path in checked:
            (self.repo / path).write_bytes(before[path] + b"\n## Coverage defect\n\n## Coverage defect\n")
        code, output = self.run_hook(MARKDOWNLINT)
        self.assertNotEqual(code, 0, output)
        self.assertIn("Linting: 69 files", output)
        for path in checked:
            self.assertIn(f"{path.as_posix()}:", output)
        self.assertIn("MD024", output)

    def test_only_the_two_exact_vendor_paths_are_exempt(self):
        for path in VENDORED:
            (self.repo / path).write_text("No heading.\n\n\n")
        self.assert_hooks_pass()
        neighbor = self.write_output(
            "skills/adversarial-review/references/non-vendored.md", "No heading.\n\n\n",
        )
        for hook in (PRETTIER, MARKDOWNLINT):
            code, output = self.run_hook(hook)
            self.assertNotEqual(code, 0, output)
            self.assertIn(neighbor, output)
        self.assertIn("MD041", output)

    def test_name_frontmatter_allows_implicit_or_single_explicit_h1_only_for_entrypoints(self):
        description = ("Long description. " * 20).rstrip()
        frontmatter = f"---\nname: heading-fixture\ndescription: {description}\n---\n\n"
        prose = ("Unwrapped prose stays on one physical line. " * 20).rstrip() + "\n"
        for relative, body in (
            ("skills/implicit/SKILL.md", prose),
            ("skills/explicit/SKILL.md", "# Explicit title\n\n" + prose),
            ("agents/implicit.md", prose),
            ("agents/explicit.md", "# Explicit title\n\n" + prose),
        ):
            self.write_output(relative, frontmatter + body)
        self.assert_hooks_pass()
        reference = self.write_output("skills/implicit/references/ordinary.md", frontmatter + prose)
        code, output = self.run_hook(MARKDOWNLINT)
        self.assertNotEqual(code, 0, output)
        self.assertIn(reference, output)
        self.assertIn("MD041", output)
        self.write_output("skills/implicit/references/ordinary.md", frontmatter + "# Reference\n\n" + prose)
        self.assert_hooks_pass()
        self.write_output("skills/explicit/SKILL.md", frontmatter + "# First\n\n# Second\n")
        code, output = self.run_hook(MARKDOWNLINT)
        self.assertNotEqual(code, 0, output)
        self.assertIn("MD025", output)

    def test_formatting_and_lint_fail_independently(self):
        reference = self.write_output("skills/fix-comments/references/formatting.md", "# Heading\n\n\nProse.\n")
        code, output = self.run_hook(PRETTIER)
        self.assertNotEqual(code, 0, output)
        self.assertIn(reference, output)
        (self.repo / reference).write_text("# Heading\n\n## Duplicate\n\n## Duplicate\n")
        code, output = self.run_hook(PRETTIER)
        self.assertEqual(code, 0, output)
        code, output = self.run_hook(MARKDOWNLINT)
        self.assertNotEqual(code, 0, output)
        self.assertIn(reference, output)
        self.assertIn("MD024", output)

    def test_authored_formatter_skips_output_and_jinja_templates(self):
        output = self.write_output("skills/formatting/SKILL.md", "# Bad formatting\n\n\n")
        template = "ai/mzizzi/skills/create-plan/SKILL.md.j2"
        before = (self.repo / template).read_bytes()
        code, message = self.run_hook("prettier", files=(output, template))
        self.assertEqual(code, 0, message)
        self.assertIn("Skipped", message)
        self.assertEqual((self.repo / template).read_bytes(), before)

    def test_pinned_real_tool_versions(self):
        config = yaml.safe_load((self.repo / ".pre-commit-config.yaml").read_text())
        hooks = {hook["id"]: hook for repo in config["repos"] for hook in repo["hooks"]}
        probe = dict(hooks[PRETTIER], entry="prettier --version")
        (self.repo / ".tool-versions.yaml").write_text(yaml.safe_dump({"repos": [{"repo": "local", "hooks": [probe]}]}))
        code, output = self.run_hook(PRETTIER, config=".tool-versions.yaml")
        self.assertEqual(code, 0, output)
        self.assertIn("3.6.2", output)
        code, output = self.run_hook(MARKDOWNLINT)
        self.assertEqual(code, 0, output)
        self.assertIn("markdownlint-cli2 v0.24.0 (markdownlint v0.42.0)", output)


if __name__ == "__main__":
    unittest.main()
