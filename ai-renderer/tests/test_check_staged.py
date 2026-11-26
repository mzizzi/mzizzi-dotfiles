from contextlib import redirect_stderr
from io import StringIO
import subprocess
import sys
from unittest.mock import patch

from git_fixture import PROTECTED_FILES, GitFixture
from renderer_test_support import snapshot_files
from render_ai import build, main


class StagedCheckTests(GitFixture):
    def cli(self, *args, cwd=None):
        return subprocess.run(
            [sys.executable, str(self.repo / "ai-renderer/render_ai.py"), *args],
            cwd=self.repo if cwd is None else cwd, capture_output=True, text=True,
        )

    def assert_current(self, *, cwd=None):
        result = self.cli("--check-staged", cwd=cwd)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Staged AI files and rendered output are current", result.stdout)

    def assert_rejected(self, expected):
        before = self.snapshot()
        result = self.cli("--check-staged")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn(expected, result.stderr)
        self.assertEqual(self.snapshot(), before, "Checks must not change output or the index")
        return result.stderr

    def test_plain_check_accepts_current_output_not_in_index(self):
        self.git("rm", "--cached", "-r", "ai-rendered")
        before = self.snapshot()
        result = self.cli("--check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("AI output is current", result.stdout)
        self.assertEqual(self.snapshot(), before)
        self.assert_rejected("untracked AI file")

    def test_untracked_and_ignored_sources_are_rejected(self):
        for filename in ("new resource.txt", "new\nresource.txt", "new\tresource.txt", "*.pyc", "hidden.env"):
            with self.subTest(filename=filename):
                path = self.template.parent / filename
                path.write_text("Untracked.\n")
                errors = self.assert_rejected(repr(path.relative_to(self.repo).as_posix()))
                self.assertIn("untracked AI file", errors)
                path.unlink()

    def test_extra_and_deleted_output(self):
        extra = self.output.parent / "extra.env"
        extra.write_text("Ignored output still matters.\n")
        self.assert_rejected("untracked AI file")
        self.git("add", "-f", str(extra))
        self.assert_rejected("stale:")
        self.git("rm", "-f", str(extra))
        self.output.unlink()
        self.assert_rejected("stage or restore")
        self.git("add", "-u")
        self.assert_rejected("missing:")

    def test_binary_and_control_character_paths_use_nul_delimited_diffs(self):
        for name in ("binary.bin", "tab\tname.txt", "line\nname.txt"):
            with self.subTest(name=name):
                path = self.template.parent / name
                path.write_bytes(b"original\0binary\n")
                self.git("add", str(path))
                path.write_bytes(b"changed\0binary\n")
                self.assert_rejected(repr(path.relative_to(self.repo).as_posix()))
                self.git("rm", "-f", str(path))

    def test_staged_source_deletion_requires_output_deletion_too(self):
        self.commit()
        self.git("rm", str(self.template))
        (self.repo / "ai").mkdir(exist_ok=True)
        self.assert_rejected("stale:")
        build(self.repo)
        self.git("add", "ai-rendered")
        self.assert_current()

    def test_partially_staged_source_and_output(self):
        self.template.write_text(self.template.read_text() + "\nStaged.\n")
        build(self.repo)
        self.git("add", "ai", "ai-rendered")
        self.assert_current()
        self.template.write_text(self.template.read_text() + "\nUnstaged.\n")
        self.assert_rejected("stage or restore")
        self.git("add", "ai")
        self.assert_rejected("changed:")
        build(self.repo)
        self.assert_rejected("stage or restore")
        self.git("add", "ai-rendered")
        self.assert_current()

    def test_relevant_index_flags_are_rejected_even_for_unchanged_files(self):
        self.commit()
        for flag in ("assume-unchanged", "skip-worktree"):
            with self.subTest(flag=flag):
                self.git("update-index", f"--{flag}", "ai-renderer/render_ai.py")
                self.assert_rejected("unsupported assume-unchanged/skip-worktree")
                self.git("update-index", f"--no-{flag}", "ai-renderer/render_ai.py")
        self.assert_current()

    def test_all_relevant_configuration_and_implementation_paths_are_checked(self):
        for relative in PROTECTED_FILES:
            with self.subTest(path=relative):
                path = self.repo / relative
                before = path.read_bytes()
                path.write_bytes(before + b"\n")
                self.assert_rejected(relative)
                path.write_bytes(before)
        self.assert_current()

    def test_untracked_relevant_inputs_fail_even_when_ignored(self):
        exclude = self.repo / ".git/info/exclude"
        self.git("rm", "--cached", *PROTECTED_FILES)
        for ignored in (False, True):
            with self.subTest(ignored=ignored):
                exclude.write_text("".join(f"/{path}\n" for path in PROTECTED_FILES) if ignored else "")
                errors = self.assert_rejected("untracked AI file")
                for path in PROTECTED_FILES:
                    self.assertIn(f"{path!r}: untracked AI file", errors)
        exclude.write_text("")
        self.git("add", *PROTECTED_FILES)
        self.assert_current()

    def test_unrelated_local_changes_and_flags_are_allowed(self):
        unrelated = self.repo / "unrelated.txt"
        unrelated.write_text("Staged.\n")
        self.git("add", str(unrelated))
        unrelated.write_text("Dirty.\n")
        (self.repo / "untracked.txt").write_text("Not an AI input.\n")
        (self.repo / "ai-renderer/local-notes.txt").write_text("Not a renderer input.\n")
        self.git("update-index", "--assume-unchanged", "unrelated.txt")
        self.assert_current()

    def test_posix_executable_changes_override_core_filemode_false(self):
        if sys.platform == "win32":
            self.skipTest("Windows retains renderer platform mode behavior")
        self.git("config", "core.filemode", "false")
        self.template.chmod(0o755)
        self.assert_rejected("stage or restore")
        self.template.chmod(0o644)
        self.output.chmod(0o755)
        self.assert_rejected("stage or restore")

    def test_failed_git_commands_are_actionable(self):
        (self.repo / ".git/index").write_bytes(b"invalid index\n")
        result = self.cli("--check-staged")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("Git staged check failed (ls-files -v)", result.stderr)

        with patch("render_ai.subprocess.run", side_effect=OSError("git unavailable")), redirect_stderr(StringIO()) as stderr:
            self.assertEqual(main(["--check-staged"]), 1)
        self.assertIn("error: git unavailable", stderr.getvalue())

    def test_git_state_errors_stop_before_renderer(self):
        self.template.write_text("Not valid metadata.\n")
        with (
            patch("render_ai.__file__", str(self.repo / "ai-renderer/render_ai.py")),
            patch("render_ai.build") as render,
            redirect_stderr(StringIO()) as stderr,
        ):
            self.assertEqual(main(["--check-staged"]), 1)
        self.assertIn("stage or restore", stderr.getvalue())
        render.assert_not_called()
        self.git("add", "ai")
        self.assert_rejected("expected YAML frontmatter")

    def test_cli_uses_script_root_not_working_directory_without_writes(self):
        before = snapshot_files(self.repo)
        self.assert_current(cwd=self.repo.parent)
        self.assertEqual(snapshot_files(self.repo), before)

    def test_cli_rejects_mixed_staged_check_and_render_options(self):
        before = self.snapshot()
        for flags in (
            ("--input", "ai"), ("--output", "ai-rendered/pi"), ("--layout", "package"),
            ("--target", "pi"), ("--check",),
            ("--input", "ai", "--output", "ai-rendered/pi", "--target", "pi"),
        ):
            with self.subTest(flags=flags):
                result = self.cli("--check-staged", *flags)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn("--check-staged cannot be combined", result.stderr)
        self.assertEqual(self.snapshot(), before)

    def test_cli_rejects_removed_stage_syntax(self):
        for args in (("--check-staged", "commit"), ("--check-candidate", "commit")):
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertIn("unrecognized arguments:", result.stderr)
