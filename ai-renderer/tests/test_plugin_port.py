import os
from pathlib import Path
import re
import shutil
import stat
import tempfile
import unittest

from test_pilot_skills import REPO, skill_document
from render_ai import Target, build

PI_DEFERRED = {"prepare-feature-branch", "implement-plan", "review-pr"}


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
            if kind == "skills":
                expected.add("renderer-example")
            self.assertEqual({path.name for path in (self.package(Target.CLAUDE) / kind).iterdir()}, expected)

    def test_skill_resources_and_pi_exclusions(self):
        for source in sorted((REPO / "plugins/mzizzi/skills").iterdir()):
            resources = {
                path.relative_to(source): path
                for path in source.rglob("*") if path.is_file() and path.name != "SKILL.md"
            }
            for target in Target:
                with self.subTest(skill=source.name, target=target):
                    output = self.package(target) / "skills" / source.name
                    if target == Target.PI and source.name in PI_DEFERRED:
                        self.assertFalse(output.exists())
                        continue
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
        expected = {path.name for path in (REPO / "plugins/mzizzi/skills").iterdir()} - PI_DEFERRED
        self.assertEqual({path.name for path in skills.iterdir()}, expected | {"renderer-example"})
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
                for forbidden in ("Skill(skill:", "Agent(subagent_type:", "EnterWorktree(", "ExitWorktree(", "SendMessage", "TaskCreate", "TaskUpdate", "run_in_background:"):
                    self.assertNotIn(forbidden, body)
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
        self.assertIn("deferred until worktree support exists", plan)
        self.assertNotIn("/skill:implement-plan", plan)
        codex = body("codex-adversarial-review")
        self.assertIn("codex@openai-codex", codex)
        self.assertIn("timeout: 600", codex)
        self.assertIn("Do not replace it with a native Pi agent", codex)


if __name__ == "__main__":
    unittest.main()
