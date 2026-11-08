import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import unittest

from test_pilot_skills import REPO, skill_document
from render_ai import Target, build


class PluginPortTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ai-plugin-port-")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        build(self.repo)

    def package(self, target):
        kind = "plugins" if target == Target.CLAUDE else "packages"
        return self.repo / "generated" / target / kind / "mzizzi"

    def test_all_claude_frontmatter_and_skill_bodies_match_original(self):
        original = REPO / "plugins/mzizzi"
        for kind, pattern in (("skills", "*/SKILL.md"), ("agents", "*.md")):
            for source in sorted((original / kind).glob(pattern)):
                with self.subTest(resource=source.relative_to(original)):
                    output = self.package(Target.CLAUDE) / source.relative_to(original)
                    expected_metadata, expected_body = skill_document(source)
                    metadata, body = skill_document(output)
                    self.assertEqual(metadata, expected_metadata)
                    if kind == "skills":
                        self.assertEqual(body, expected_body)
            expected = {path.name for path in (original / kind).iterdir()}
            self.assertEqual({path.name for path in (self.package(Target.CLAUDE) / kind).iterdir()}, expected)

    def test_skill_resources_match_both_targets(self):
        for source in sorted((REPO / "plugins/mzizzi/skills").iterdir()):
            resources = {
                path.relative_to(source): path
                for path in source.rglob("*") if path.is_file() and path.name != "SKILL.md"
            }
            for target in Target:
                with self.subTest(skill=source.name, target=target):
                    output = self.package(target) / "skills" / source.name
                    self.assertEqual(
                        {path.relative_to(output) for path in output.rglob("*") if path.is_file()},
                        {Path("SKILL.md"), *resources},
                    )
                    for relative, original in resources.items():
                        staging = self.repo / "ai/mzizzi/skills" / source.name / relative
                        for copy in (staging, output / relative):
                            self.assertEqual(copy.read_bytes(), original.read_bytes())
                            if os.name != "nt":
                                self.assertEqual(stat.S_IMODE(copy.stat().st_mode), stat.S_IMODE(original.stat().st_mode))

    def test_pi_workflows_forward_arguments_without_claude_tool_calls(self):
        skills = self.package(Target.PI) / "skills"
        expected = {path.name for path in (REPO / "plugins/mzizzi/skills").iterdir()}
        self.assertEqual({path.name for path in skills.iterdir()}, expected)
        for name in sorted(expected):
            with self.subTest(skill=name):
                metadata, body = skill_document(skills / name / "SKILL.md")
                original_metadata, original_body = skill_document(REPO / "plugins/mzizzi/skills" / name / "SKILL.md")
                description = original_metadata["description"]
                if name == "auto-brainstorm":
                    description = description.replace("mzizzi:complex", "mzizzi.complex")
                self.assertEqual(metadata, {
                    "name": name,
                    "description": description,
                    "disable-model-invocation": original_metadata["disable-model-invocation"],
                })
                forbidden = ["Skill(skill:", "Agent(subagent_type:", "SendMessage", "run_in_background:"]
                if name not in {"prepare-feature-branch", "review-pr"}:
                    forbidden.extend(["EnterWorktree(", "ExitWorktree("])
                if name != "implement-plan":
                    forbidden.extend(["TaskCreate", "TaskUpdate"])
                for token in forbidden:
                    self.assertNotIn(token, body)
                self.assertNotRegex(body, r"mzizzi:[a-z-]+")
                for args in re.findall(r'Skill\(skill: "[a-z-]+",\s*args: "([^"]*)"\)', original_body):
                    self.assertIn(args, body)

    def test_pi_adaptations_keep_live_interviews_review_order_and_stop_conditions(self):
        def body(name):
            return skill_document(self.package(Target.PI) / "skills" / name / "SKILL.md")[1]

        interview = body("auto-brainstorm")
        self.assertIn('async: true', interview)
        self.assertIn('contact_supervisor({ reason: "need_decision"', interview)
        self.assertIn('subagent_supervisor({ action: "reply", replyTo:', interview)
        self.assertIn("must not finish between questions", interview)
        self.assertIn("Steering is not a substitute for replying", interview)
        self.assertIn("reply `STOP` to its pending request", interview)
        self.assertIn('action: "stop"', interview)
        self.assertNotIn('action: "resume"', interview)
        self.assertNotIn("latest interviewee run id", interview)
        self.assertNotIn("answer it and stop", interview)
        self.assertIn("It defaults to 2.", interview)
        self.assertIn("do not review again", interview)
        quality = body("fix-quality")
        self.assertIn("runs.all(", quality)
        self.assertIn('context: "fresh"', quality)
        self.assertIn("strictly read-only", quality)
        self.assertIn("including step 6", quality)
        self.assertIn("report its exact error and missing coverage", quality)
        sweep = body("fix-all")
        self.assertLess(sweep.index("../fix-correctness/SKILL.md"), sweep.index("../fix-quality/SKILL.md"))
        self.assertLess(sweep.index("../fix-quality/SKILL.md"), sweep.index("../fix-comments/SKILL.md"))
        self.assertIn("If fix-correctness stops without reviewing, stop", sweep)
        plan = body("create-plan")
        self.assertIn("never ask the user a question", plan)
        self.assertIn("If the decider fails, report the blocker and stop", plan)
        self.assertIn("/skill:implement-plan <target file path>", plan)
        self.assertNotIn("deferred until worktree support exists", plan)
        codex = body("codex-adversarial-review")
        self.assertIn("codex@openai-codex", codex)
        self.assertIn("timeout: 600", codex)
        self.assertIn("Do not replace it with a native Pi agent", codex)

    def test_pi_worktree_workflows_preserve_order_scope_and_cleanup(self):
        def body(name):
            return skill_document(self.package(Target.PI) / "skills" / name / "SKILL.md")[1]

        prepare = body("prepare-feature-branch")
        for action in ("stay", "enter-worktree", "switch", "judge-current-branch-then-create", "create"):
            self.assertIn(f"**`{action}`**", prepare)
        self.assertIn('EnterWorktree({path: "<WORKTREE_PATH>"})', prepare)
        self.assertIn("alone in its message", prepare)
        self.assertIn("Wait for completed entry", prepare)
        self.assertIn("no outstanding child work", prepare)
        self.assertIn("stop for a transfer decision", prepare)
        self.assertIn("do not silently copy or commit elsewhere", prepare)
        self.assertNotIn("rerun the same command with elevated permissions", prepare)
        self.assertNotIn("the worktree's diff is clean either way", prepare)

        implementation = body("implement-plan")
        self.assertLess(implementation.index("../prepare-feature-branch/SKILL.md"), implementation.index("## Step 2"))
        self.assertLess(implementation.index("TaskCreate"), implementation.index("subagent({"))
        self.assertLess(implementation.index("subagent({"), implementation.index("../fix-all/SKILL.md"))
        self.assertIn("including completed worktree entry", implementation)
        self.assertIn("the `mzizzi.standard` agent: delegate at least one child per phase", implementation)
        self.assertIn('cwd:"<selected absolute cwd>"', implementation)
        self.assertIn('options:{context:"fresh"}', implementation)
        self.assertIn("--plan <plan document path> --strictness=high --apply=all", implementation)
        self.assertIn("same checkout and uncommitted diff", implementation)
        self.assertIn("Do not automatically exit", implementation)
        self.assertNotRegex(implementation, r"worktree\s*:\s*true")

        review = body("review-pr")
        self.assertIn("git worktree add --detach", review)
        self.assertIn("git worktree list --porcelain -z", review)
        self.assertIn("bindingWasActive", review)
        self.assertIn('EnterWorktree({path:"<start>"})', review)
        self.assertIn('ExitWorktree({action:"keep"})', review)
        self.assertIn("Wait for completed return", review)
        self.assertIn("--apply=none --base origin/<baseRefName>", review)
        self.assertIn("git worktree remove <path>", review)
        self.assertNotIn("git worktree remove --force", review)
        self.assertIn("Never force removal without approval", review)


if __name__ == "__main__":
    unittest.main()
