import subprocess
import sys
from unittest.mock import patch

from git_fixture import GitFixture
from check_ai import RELEVANT_PATHS, check, check_git_state, main
from render_ai import RenderError, build


class CandidateTests(GitFixture):
    def assert_rejected(self, expected, *, push=False):
        before = self.snapshot()
        errors = check(self.repo, push=push)
        self.assertTrue(any(expected in error for error in errors), errors)
        self.assertEqual(self.snapshot(), before, "Checks must not change output or the index")
        return errors

    def test_initial_index_and_clean_head_pass(self):
        self.assertEqual(check(self.repo), [])
        self.commit()
        self.assertEqual(check(self.repo, push=True), [])

    def test_unstaged_canonical_new_output_is_not_a_candidate(self):
        self.git("rm", "--cached", "-r", "ai-rendered")
        self.assertEqual(build(self.repo, check=True), [])
        self.assert_rejected("untracked AI file")

    def test_untracked_and_ignored_sources_are_rejected(self):
        for filename in ("new resource.txt", "new\nresource.txt", "new\tresource.txt", "*.pyc", "hidden.env"):
            with self.subTest(filename=filename):
                path = self.template.parent / filename
                path.write_text("Untracked.\n")
                errors = self.assert_rejected(repr(path.relative_to(self.repo).as_posix()))
                self.assertTrue(any("untracked AI file" in error for error in errors), errors)
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
        self.assertEqual(check(self.repo), [])

    def test_partially_staged_source_and_output(self):
        self.template.write_text(self.template.read_text() + "\nStaged.\n")
        build(self.repo)
        self.git("add", "ai", "ai-rendered")
        self.assertEqual(check(self.repo), [])
        self.template.write_text(self.template.read_text() + "\nUnstaged.\n")
        self.assert_rejected("stage or restore")
        self.git("add", "ai")
        self.assert_rejected("changed:")
        build(self.repo)
        self.assert_rejected("stage or restore")
        self.git("add", "ai-rendered")
        self.assertEqual(check(self.repo), [])

    def test_relevant_index_flags_are_rejected_even_for_unchanged_files(self):
        self.commit()
        for flag in ("assume-unchanged", "skip-worktree"):
            with self.subTest(flag=flag):
                self.git("update-index", f"--{flag}", "ai-renderer/render_ai.py")
                self.assert_rejected("unsupported assume-unchanged/skip-worktree")
                self.git("update-index", f"--no-{flag}", "ai-renderer/render_ai.py")
        self.assertEqual(check(self.repo), [])

    def test_all_relevant_configuration_and_implementation_paths_are_checked(self):
        for relative in RELEVANT_PATHS:
            if relative.endswith("/"):
                continue
            with self.subTest(path=relative):
                path = self.repo / relative
                before = path.read_bytes()
                path.write_bytes(before + b"\n")
                self.assert_rejected(relative)
                path.write_bytes(before)
        self.assertEqual(check(self.repo), [])

    def test_untracked_relevant_inputs_fail_commit_and_push_even_when_ignored(self):
        self.commit()
        exclude = self.repo / ".git/info/exclude"
        for relative in RELEVANT_PATHS:
            if relative.endswith("/"):
                continue
            with self.subTest(path=relative):
                self.git("rm", "--cached", relative)
                self.commit("Omit relevant input")
                for ignored in (False, True):
                    exclude.write_text(f"/{relative}\n" if ignored else "")
                    for push in (False, True):
                        with self.subTest(ignored=ignored, push=push):
                            errors = self.assert_rejected(repr(relative), push=push)
                            self.assertTrue(any("untracked AI file" in error for error in errors), errors)
                exclude.write_text("")
                self.git("add", "-f", relative)
                self.commit("Restore relevant input")
        self.assertEqual(check(self.repo, push=True), [])

    def test_unrelated_local_changes_and_flags_are_allowed(self):
        unrelated = self.repo / "unrelated.txt"
        unrelated.write_text("Staged.\n")
        self.git("add", str(unrelated))
        self.commit()
        unrelated.write_text("Dirty.\n")
        (self.repo / "untracked.txt").write_text("Not an AI input.\n")
        self.git("update-index", "--assume-unchanged", "unrelated.txt")
        self.assertEqual(check(self.repo, push=True), [])

    def test_posix_executable_changes_override_core_filemode_false(self):
        if sys.platform == "win32":
            self.skipTest("Windows retains renderer platform mode behavior")
        self.git("config", "core.filemode", "false")
        self.template.chmod(0o755)
        self.assert_rejected("stage or restore")
        self.template.chmod(0o644)
        self.output.chmod(0o755)
        self.assert_rejected("stage or restore")

    def test_push_rejects_staged_repair_of_stale_head(self):
        self.template.write_text(self.template.read_text() + "\nDrift.\n")
        self.git("add", "ai")
        self.commit()
        build(self.repo)
        self.git("add", "ai-rendered")
        self.assertEqual(check(self.repo), [])
        self.assert_rejected("push candidate differs from HEAD", push=True)

    def test_failed_git_commands_and_renderer_failures_are_actionable(self):
        with patch("check_ai.subprocess.run", return_value=subprocess.CompletedProcess([], 128, b"", b"fatal: fixture error")):
            with self.assertRaisesRegex(RenderError, "Git candidate check failed.*fixture error"):
                check_git_state(self.repo)
            self.assertEqual(main([]), 1)
        with patch("check_ai.check_git_state", return_value=[]), patch("check_ai.build", side_effect=RenderError("broken template")):
            self.assertEqual(main([]), 1)
        with patch("check_ai.check", side_effect=OSError("git unavailable")):
            self.assertEqual(main(["--push"]), 1)

    def test_candidate_errors_stop_before_renderer(self):
        self.template.write_text("Not valid metadata.\n")
        with patch("check_ai.build") as render:
            self.assert_rejected("stage or restore")
            render.assert_not_called()

    def test_cli_uses_script_root_not_working_directory(self):
        result = subprocess.run(
            [sys.executable, str(self.repo / "ai-renderer/check_ai.py")],
            cwd=self.repo.parent, capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("AI candidate and rendered output are current", result.stdout)
