import os
from pathlib import Path, PureWindowsPath
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from renderer_test_support import RENDERER, snapshot_files
from render_ai import MARKER, Layout, RenderError, Target, build_targets, check_windows_path, contains_tree


SKILL = "renderer-native-example"
CLAUDE_ONLY = "renderer-claude-only"


class ProjectSkillTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="render project ")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name).resolve()
        self.source = self.repo / "ai/consumer/skills"
        shutil.copytree(RENDERER / "tests/fixtures/project/skills", self.source)
        self.template = self.source / SKILL / "SKILL.md.j2"
        self.pi = self.repo / ".pi/skills"
        self.claude = self.repo / ".claude/skills"

    def cli(self, *args, code=0):
        run = subprocess.run(
            [sys.executable, str(RENDERER / "render_ai.py"), *args],
            cwd=self.repo, capture_output=True, text=True,
        )
        self.assertEqual(run.returncode, code, run.stdout + run.stderr)
        return run.stdout + run.stderr

    def render(self, *args, target="pi", output=None, code=0):
        if output is None:
            output = self.repo / f".{target}/skills"
        if isinstance(output, Path) and output.is_relative_to(self.repo):
            output = output.relative_to(self.repo)
        return self.cli(
            "--input", self.source.relative_to(self.repo), "--output", output,
            "--target", target, *args, code=code,
        )

    snapshot = staticmethod(snapshot_files)

    def test_native_layout_target_isolation_and_support_resources(self):
        (self.source / "models.json").write_text("not a model catalog")
        asset = self.template.with_name("asset.bin")
        asset.write_bytes(b"\x00\xff{{ literal }}\r\n")
        asset.chmod(0o755)
        self.assertIn("missing:", self.render("--check", target="claude", code=1))
        self.assertFalse(self.claude.parent.exists(), "Check must not create parents")
        self.claude.parent.mkdir()
        settings = self.claude.parent / "settings.json"
        settings.write_bytes(b"{}\n")
        self.render("--layout", "project", target="claude")
        self.assertFalse(self.pi.parent.exists())
        claude_before = self.snapshot(self.claude)
        self.render()
        self.assertEqual(self.snapshot(self.claude), claude_before)
        self.assertEqual(settings.read_bytes(), b"{}\n")
        for target, root in (("claude", self.claude), ("pi", self.pi)):
            with self.subTest(target=target):
                entry = root / SKILL / "SKILL.md"
                self.assertIn(f"name: {SKILL}\n", entry.read_text())
                self.assertIn(f"{target.capitalize()} loads the `{SKILL}` skill", entry.read_text())
                files = {Path(MARKER), Path(SKILL, "SKILL.md"), Path(SKILL, asset.name)}
                if target == "claude":
                    files.add(Path(CLAUDE_ONLY, "SKILL.md"))
                self.assertEqual(set(self.snapshot(root)), files)
                copied = entry.with_name(asset.name)
                self.assertEqual(copied.read_bytes(), asset.read_bytes())
                if os.name != "nt":
                    self.assertEqual(stat.S_IMODE(copied.stat().st_mode), 0o755)
                self.render("--check", target=target)

    def test_check_reports_drift_and_repair_does_not_stage_output(self):
        subprocess.run(["git", "init", "--quiet"], cwd=self.repo, check=True)
        subprocess.run(["git", "add", "ai"], cwd=self.repo, check=True)
        index = self.repo / ".git/index"
        index_before = index.read_bytes()
        self.cli("--input", self.source, "--output", self.pi, "--target", "pi")
        expected = self.snapshot(self.pi)
        (self.pi / SKILL / "SKILL.md").write_text("Local edit.\n")
        (self.pi / "note.txt").write_text("Untracked note.\n")
        drifted = self.snapshot(self.pi)
        check = self.render("--check", code=1)
        self.assertIn("changed:", check)
        self.assertIn("stale:", check)
        self.assertIn("note.txt", check)
        self.assertEqual(self.snapshot(self.pi), drifted)
        self.assertEqual(index.read_bytes(), index_before)
        self.render()
        self.assertEqual(self.snapshot(self.pi), expected)
        self.assertEqual(index.read_bytes(), index_before)

    def test_all_excluded_clears_output_but_empty_input_is_rejected(self):
        self.render()
        before = self.snapshot(self.pi)
        excluded = self.template.read_text().replace("claude:\n", "pi: false\nclaude:\n")
        for path in self.source.glob("*/SKILL.md.j2"):
            path.unlink()
        self.assertIn("no project skill sources", self.render(code=1))
        self.assertEqual(self.snapshot(self.pi), before)
        self.template.write_text(excluded)
        self.render()
        self.assertEqual(list(self.pi.iterdir()), [self.pi / MARKER])
        self.render("--check")

    def test_bad_references_templates_and_collisions_preserve_output(self):
        self.render()
        (self.pi / "output-only.md.j2").write_text("Not input.\n")
        before = self.snapshot(self.pi)
        for body, error in (
            ('{{ Skill("missing") }}', "unknown skill"),
            (f'{{{{ Skill("consumer:{SKILL}") }}}}', "unknown skill"),
            (f'{{{{ Skill("{CLAUDE_ONLY}") }}}}', "reference to excluded resource"),
            ('{{ Agent("external") }}', "unknown agent"),
            ("{{ models.sol }}", "has no attribute 'sol'"),
            ('{% include "output-only.md.j2" %}', "output-only.md.j2"),
        ):
            with self.subTest(body=body):
                self.template.write_text(f"---\ndescription: Example.\n---\n{body}\n")
                self.assertIn(error, self.render(code=1))
                self.assertEqual(self.snapshot(self.pi), before)
        self.template.write_text("---\ndescription: Example.\n---\n")
        self.template.with_name("SKILL.md").write_text("Conflicting resource.\n")
        self.assertIn("duplicate output destination", self.render(code=1))
        self.assertEqual(self.snapshot(self.pi), before)

    def test_source_scan_error_preserves_output(self):
        self.render(target="claude")
        before = self.snapshot(self.claude)
        iterdir = Path.iterdir
        for blocked in (self.source / CLAUDE_ONLY, self.template.parent / "_templates"):
            with self.subTest(blocked=blocked):
                def fail_iterdir(path):
                    if path == blocked:
                        raise PermissionError(f"cannot scan {path}")
                    return iterdir(path)

                with patch.object(Path, "iterdir", fail_iterdir):
                    with self.assertRaisesRegex(PermissionError, "cannot scan"):
                        build_targets(self.source, {Target.CLAUDE: self.claude}, layout=Layout.PROJECT)
                self.assertEqual(self.snapshot(self.claude), before)

    def test_case_aliased_artifact_is_rejected_in_check_and_write(self):
        self.render()
        before = self.snapshot(self.pi)
        self.template.with_name("skill.md").write_text("Not a generated skill.\n")
        for args in ((), ("--check",)):
            self.assertIn("duplicate output destination", self.render(*args, code=1))
            self.assertEqual(self.snapshot(self.pi), before)

    @unittest.skipIf(os.name == "nt", "Fixture needs case-distinct input directories")
    def test_case_aliased_output_directories_are_rejected(self):
        first = self.template.parent / "Notes"
        second = self.template.parent / "notes"
        first.mkdir()
        if second.exists():
            self.skipTest("Fixture needs case-distinct input directories")
        second.mkdir()
        (first / "one.md").write_text("One.\n")
        (second / "two.md").write_text("Two.\n")
        self.assertIn("case-aliased output directory", self.render(code=1))
        self.assertFalse(self.pi.parent.exists())

    def test_overlapping_target_roots_are_rejected_before_publication(self):
        for destination in (self.claude, self.claude / "pi"):
            with self.subTest(destination=destination):
                with self.assertRaisesRegex(RenderError, "output trees must not overlap"):
                    build_targets(
                        self.source, {Target.CLAUDE: self.claude, Target.PI: destination}, layout=Layout.PROJECT,
                    )
                self.assertFalse(self.claude.parent.exists())

    def test_invalid_cli_combinations_are_usage_errors(self):
        source = ("--input", self.source)
        output = ("--output", self.pi)
        for args in (
            source, output, (*source, *output), (*source, "--target", "pi"),
            (*output, "--target", "pi"), ("--layout", "project"),
            (*source, "--output", "", "--target", "pi"),
            ("--input", "", *output, "--target", "pi"),
            (*source, *output, "--target", "unknown"),
            (*source, *output, "--target", "pi", "--layout", "unknown"),
        ):
            with self.subTest(args=args):
                self.assertIn("usage:", self.cli(*args, code=2))
                self.assertFalse(self.pi.parent.exists())

    def test_equal_ancestor_and_descendant_outputs_are_rejected(self):
        before = self.snapshot(self.source)
        for output in (self.source, self.source.parent, self.source / "generated"):
            with self.subTest(output=output):
                self.assertIn("must not overlap", self.render(output=output, code=1))
                self.assertEqual(self.snapshot(self.source), before)
        self.assertFalse((self.source / "generated").exists())

    def test_missing_output_checks_identity_of_existing_ancestors(self):
        source_stat = self.source.stat()
        alias = self.repo / "alias"
        stat_path = Path.stat

        def stat_with_alias(path):
            return source_stat if path == alias else stat_path(path)

        with patch.object(Path, "stat", stat_with_alias):
            self.assertTrue(contains_tree(self.source, alias / "new"))

    def test_unowned_nonempty_output_is_not_replaced(self):
        self.pi.mkdir(parents=True)
        manual = self.pi / "keep.txt"
        manual.write_bytes(b"Keep.\n")
        before = self.snapshot(self.pi)
        for args in ((), ("--check",)):
            self.assertIn("unowned output", self.render(*args, code=1))
            self.assertEqual(self.snapshot(self.pi), before)
        manual.unlink()
        self.render()
        self.assertTrue((self.pi / MARKER).is_file())

    def test_project_and_package_markers_do_not_authorize_each_other(self):
        package_source = self.repo / "package-input"
        other_skill = package_source / "fixture/skills/mini"
        other_skill.mkdir(parents=True)
        (package_source / "models.json").write_text("{}")
        (other_skill / "SKILL.md.j2").write_text("---\ndescription: Package fixture.\n---\n")
        package_out = self.repo / "ai-rendered/pi"
        package_args = ("--layout", "package", "--input", package_source, "--target", "pi", "--output")
        self.cli(*package_args, package_out)
        self.render()
        package_before, project_before = self.snapshot(package_out), self.snapshot(self.pi)
        self.assertIn("expected project marker", self.render(output=package_out, code=1))
        self.assertIn("expected package marker", self.cli(*package_args, self.pi, code=1))
        self.assertEqual(self.snapshot(package_out), package_before)
        self.assertEqual(self.snapshot(self.pi), project_before)

    @unittest.skipIf(os.name == "nt", "Symlinks can require extra privileges on Windows")
    def test_linked_output_and_ancestors_are_rejected(self):
        external = self.repo / "external"
        external.mkdir()
        linked = self.repo / "linked"
        linked.symlink_to(external, target_is_directory=True)
        for output in (linked, linked / "skills", linked / "nested/skills", linked / "../new/skills"):
            with self.subTest(output=output):
                self.assertIn("output symlinks", self.render(output=output, code=1))
                self.assertEqual(list(external.iterdir()), [])
        self.assertFalse((self.repo / "new").exists())
        alias = self.repo / "source-parent"
        alias.symlink_to(self.source.parent, target_is_directory=True)
        self.assertIn("must not overlap", self.cli(
            "--input", alias / "skills", "--output", self.source / "generated", "--target", "pi", code=1,
        ))
        self.assertFalse((self.source / "generated").exists())

    @unittest.skipUnless(os.name == "nt", "Windows filesystem aliases")
    def test_windows_path_and_emitted_filename_aliases_are_rejected(self):
        case_alias = self.source.with_name(self.source.name.upper())
        self.assertIn("must not overlap", self.render(output=case_alias, code=1))
        self.assertIn("ambiguous Windows output path", self.render(output=".pi./skills", code=1))
        self.assertIn("ambiguous Windows input path", self.cli(
            "--input", f"{self.source}.", "--output", self.pi, "--target", "pi", code=1,
        ))
        alias = self.template.with_name("support..j2")
        alias.write_text("Invalid output name.\n")
        self.assertIn("ambiguous Windows output path", self.render(code=1))
        self.assertFalse(self.pi.parent.exists())

    @unittest.skipUnless(os.name == "nt", "Windows directory junctions")
    def test_windows_output_junctions_are_rejected(self):
        external = self.repo / "external"
        external.mkdir()
        linked = self.repo / "junction"
        subprocess.run(["cmd", "/c", "mklink", "/J", str(linked), str(external)], check=True, capture_output=True)
        self.addCleanup(linked.rmdir)
        for output in (linked, linked / "nested/skills"):
            with self.subTest(output=output):
                self.assertIn("output symlinks and junctions", self.render(output=output, code=1))
                self.assertEqual(list(external.iterdir()), [])


class WindowsPathSpellingTests(unittest.TestCase):
    def test_ambiguous_paths_are_rejected(self):
        for value in (
            r"C:skills", r"\\?\C:\skills", r"\\.\C:\skills", r".pi.\skills",
            r".pi \skills", r".pi\skills:stream", r".pi\NUL.txt",
        ):
            with self.subTest(path=value):
                with self.assertRaisesRegex(RenderError, "ambiguous Windows output path"):
                    check_windows_path(PureWindowsPath(value), "output")
        check_windows_path(PureWindowsPath(r"C:\checkout\..\.pi\skills"), "output")


if __name__ == "__main__":
    unittest.main()
