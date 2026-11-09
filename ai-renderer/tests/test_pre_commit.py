import shutil
import subprocess

from git_fixture import GitFixture
from test_render_ai import REPO
from render_ai import build


class InstalledHookTests(GitFixture):
    @classmethod
    def setUpClass(cls):
        cls.pre_commit = shutil.which("pre-commit")
        if cls.pre_commit is None:
            raise RuntimeError("Installed-hook acceptance tests require pre-commit and Node >=22.")

    def setUp(self):
        super().setUp()
        for _ in range(2):
            result = subprocess.run(
                [self.pre_commit, "install", "--install-hooks"],
                cwd=self.repo, text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        for hook in ("pre-commit", "pre-push"):
            self.assertTrue((self.repo / ".git/hooks" / hook).is_file())

    def remote(self):
        remote = self.repo.parent / "remote.git"
        self.git("init", "--bare", str(remote))
        self.git("remote", "add", "origin", str(remote))
        return remote

    def remote_refs(self):
        return self.git("ls-remote", "origin").stdout

    def assert_hook_failure(self, action, hook, *, contains=()):
        before = self.snapshot()
        head = self.git("rev-parse", "--verify", "HEAD", success=False).stdout
        result = action()
        output = result.stdout + result.stderr
        self.assertNotEqual(result.returncode, 0, output)
        self.assertIn(f"- hook id: {hook}", output)
        for text in contains:
            self.assertIn(text, output)
        after = self.snapshot()
        self.assertEqual(after[0], before[0], "Hooks must not stage files")
        self.assertEqual(after[2], before[2], "Hooks must not rewrite rendered output")
        self.assertEqual(self.git("rev-parse", "--verify", "HEAD", success=False).stdout, head)
        return output

    def failed_commit(self, hook, *, contains=()):
        return self.assert_hook_failure(lambda: self.commit(success=False), hook, contains=contains)

    def failed_push(self, hook, *, contains=()):
        before = self.remote_refs()
        result = self.assert_hook_failure(
            lambda: self.git("push", "origin", "main", success=False), hook, contains=contains,
        )
        self.assertEqual(self.remote_refs(), before, "Failed push must leave remote refs unchanged")
        return result

    def bypass_commit(self):
        # Only to construct invalid committed candidates in this disposable repo.
        self.git("-c", f"core.hooksPath={self.repo / '.git/no-hooks'}", "commit", "-m", "Invalid fixture")

    def render_and_stage(self):
        build(self.repo)
        self.git("add", "ai", "ai-rendered")

    def test_full_corpus_clean_candidate_passes_all_files_at_both_stages(self):
        shutil.rmtree(self.repo / "ai")
        shutil.copytree(REPO / "ai", self.repo / "ai")
        build(self.repo)
        self.git("add", "-A")
        self.commit("Full authored and rendered corpus")
        before = self.snapshot()
        for stage in ("pre-commit", "pre-push"):
            result = subprocess.run(
                [self.pre_commit, "run", "--all-files", "--hook-stage", stage, "--verbose"],
                cwd=self.repo, capture_output=True, text=True,
            )
            output = result.stdout + result.stderr
            self.assertEqual(result.returncode, 0, output)
            self.assertIn("Linting: 69 files", output)
            self.assertIn("Summary: 0 issues in 0 files", output)
        after = self.snapshot()
        self.assertEqual(after[0], before[0])
        self.assertEqual(after[2], before[2])
        self.remote()
        self.git("push", "origin", "main")

    def test_initial_unrelated_only_commit_and_real_push(self):
        self.commit("Initial candidate")
        unrelated = self.repo / "unrelated.txt"
        unrelated.write_text("Unrelated staged file.\n")
        self.git("add", str(unrelated))
        unrelated.write_text("Unrelated local edits.\n")
        (self.repo / "local-untracked.txt").write_text("Keep this.\n")
        self.commit("Unrelated only")
        self.assertEqual(unrelated.read_text(), "Unrelated local edits.\n")
        self.remote()
        self.git("push", "origin", "main")
        self.assertIn(self.git("rev-parse", "HEAD").stdout.strip(), self.remote_refs())
        self.assertEqual(unrelated.read_text(), "Unrelated local edits.\n")

    def test_source_only_drift_fails_then_explicit_render_and_stage_repairs(self):
        self.commit()
        self.template.write_text(self.template.read_text() + "\nSource-only drift.\n")
        self.git("add", "ai")
        message = self.failed_commit("check-ai", contains=("changed:", "python ai-renderer/render_ai.py"))
        self.assertNotIn("check rendered Markdown formatting", message, "Candidate fail_fast must stop later hooks")
        self.render_and_stage()
        self.commit("Explicit repair")

    def test_untracked_output_and_ignored_source_cannot_satisfy_initial_commit(self):
        self.git("rm", "--cached", "-r", "ai-rendered")
        self.failed_commit("check-ai", contains=("untracked AI file", "ai-rendered/"))
        self.git("add", "ai-rendered")
        ignored = self.template.parent / "not-staged.env"
        ignored.write_text("Renderer copies ignored resources too.\n")
        self.failed_commit("check-ai", contains=("not-staged.env", "untracked AI file"))
        ignored.unlink()
        self.commit("Tracked complete output")

    def test_untracked_checker_and_markdown_config_block_real_commit_and_push(self):
        self.commit()
        self.remote()
        self.git("push", "origin", "main")
        for relative in ("ai-renderer/check_ai.py", ".markdownlint-cli2.yaml"):
            with self.subTest(path=relative):
                self.git("rm", "--cached", relative)
                self.failed_commit("check-ai", contains=(relative, "untracked AI file"))
                self.bypass_commit()
                self.failed_push("check-ai-push", contains=(relative, "untracked AI file"))
                self.git("add", relative)
                self.commit("Include required checker input")
                self.git("push", "origin", "main")

    def test_partial_staging_restores_unstaged_source_and_output_on_pass_and_failure(self):
        self.commit()
        self.template.write_text(self.template.read_text() + "\nStaged source.\n")
        self.render_and_stage()
        self.template.write_text(self.template.read_text() + "\nUnstaged source.\n")
        build(self.repo)
        source_before = self.template.read_bytes()
        output_before = self.snapshot()[2]
        self.commit("Only staged candidate")
        self.assertEqual(self.template.read_bytes(), source_before)
        self.assertEqual(self.snapshot()[2], output_before)
        self.git("restore", "ai", "ai-rendered")
        self.template.write_text(self.template.read_text() + "\nStaged drift.\n")
        self.git("add", "ai")
        self.template.write_text(self.template.read_text() + "\nUnstaged second edit.\n")
        build(self.repo)
        source_before = self.template.read_bytes()
        self.failed_commit("check-ai", contains=("changed:", "Unstaged files detected"))
        self.assertEqual(self.template.read_bytes(), source_before)

    def test_real_push_rejects_stale_head_and_staged_repair_then_clean_retry(self):
        self.commit()
        self.remote()
        self.git("push", "origin", "main")
        self.template.write_text(self.template.read_text() + "\nCommitted source-only drift.\n")
        self.git("add", "ai")
        self.bypass_commit()
        self.failed_push("check-ai-push", contains=("changed:",))
        self.render_and_stage()
        self.failed_push("check-ai-push", contains=("push candidate differs from HEAD",))
        self.commit("Commit repaired candidate")
        self.git("push", "origin", "main")
        self.assertIn(self.git("rev-parse", "HEAD").stdout.strip(), self.remote_refs())

    def test_real_commit_and_push_reject_formatting_and_lint_after_candidate_passes(self):
        self.commit()
        self.remote()
        self.git("push", "origin", "main")
        original = self.template.read_text()
        for body, hook, detail in (
            ("# Demo\n\n\nBad spacing.\n", "prettier-ai-rendered", "[warn] ai-rendered/"),
            ("# Demo\n\n## Duplicate\n\n## Duplicate\n", "markdownlint-ai-rendered", "MD024"),
        ):
            with self.subTest(hook=hook):
                self.template.write_text(original.split("# Demo", 1)[0] + body)
                self.render_and_stage()
                self.failed_commit(hook, contains=("check AI commit candidate", "Passed", detail))
                self.bypass_commit()
                self.failed_push(hook, contains=("check AI push candidate", "Passed", detail))
                self.template.write_text(original)
                self.render_and_stage()
                self.commit("Fix authored template and render")
                self.git("push", "origin", "main")

    def test_output_only_drift_fails_generation_not_markdown_tools(self):
        self.commit()
        self.output.write_text(self.output.read_text() + "\n\n\n")
        self.git("add", "ai-rendered")
        output = self.failed_commit("check-ai", contains=("changed:",))
        self.assertNotIn("- hook id: prettier-ai-rendered", output)

    def test_push_checks_authored_markdown_without_rewriting_it(self):
        self.commit()
        self.remote()
        self.git("push", "origin", "main")
        authored = self.repo / "README.md"
        authored.write_text("# Authored\n\n\nBad spacing.\n")
        self.git("add", "README.md")
        self.bypass_commit()
        before = authored.read_bytes()
        self.failed_push("prettier-push", contains=("README.md",))
        self.assertEqual(authored.read_bytes(), before)
