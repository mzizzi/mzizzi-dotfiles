import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_pilot_skills import REPO
from render_ai import Target, build


class AdversarialReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ai-adversarial-review-")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        build(self.repo)

    def bundle(self, target):
        kind = "plugins" if target == Target.CLAUDE else "packages"
        return self.repo / "ai-rendered" / target / kind / "mzizzi/skills/adversarial-review"

    def test_shared_review_assets_and_target_specific_transport(self):
        claude, pi = (self.bundle(target) for target in Target)
        for relative in (
            "references/adversarial-review.md", "references/review-output.schema.json",
            "references/CODEX-LICENSE", "references/CODEX-NOTICE",
            "scripts/lib/review.mjs", "scripts/lib/review-format.mjs",
        ):
            self.assertEqual((claude / relative).read_bytes(), (pi / relative).read_bytes())
        report = json.loads((pi / "references/review-output.schema.json").read_text())
        self.assertEqual(report["required"], ["verdict", "summary", "findings", "next_steps"])
        native = (pi / "scripts/run_review.mjs").read_text()
        self.assertNotIn("installed_plugins", native)
        self.assertNotIn("runAppServerTurn", native)
        self.assertIn('command === "prepare"', native)
        self.assertIn('command === "render"', native)
        self.assertIn("runAppServerTurn", (claude / "scripts/run_review.mjs").read_text())
        for bundle in (claude, pi):
            self.assertFalse((bundle / "_templates").exists())
            self.assertFalse((bundle.parent / "codex-adversarial-review").exists())
            self.assertFalse(list(bundle.rglob("*.j2")))
            self.assertFalse((bundle / "references/PROVENANCE.md").exists())

    def test_callers_resolve_the_renamed_skill(self):
        for target in Target:
            root = self.bundle(target).parent
            for skill in ("create-plan", "fix-correctness"):
                body = (root / skill / "SKILL.md").read_text()
                self.assertNotIn("codex-adversarial-review", body)
                self.assertIn("adversarial-review", body)
            pi = target == Target.PI
            review = (root / "adversarial-review/SKILL.md").read_text()
            self.assertEqual("mzizzi.adversarial-reviewer" in review, pi)
            self.assertEqual('prepare --files' in review, pi)
            self.assertEqual('600000' in review, not pi)

    def test_skill_text_keeps_actions_without_portability_commentary(self):
        for target in Target:
            for skill in self.bundle(target).parent.glob("*/SKILL.md"):
                with self.subTest(target=target, skill=skill.parent.name):
                    body = skill.read_text()
                    for explanation in (
                        "Both implementations use", "not Pi core", "human-only",
                        "formatter's normalization", "Each nested skill resolves",
                        "Then return to this workflow", "do not assume Claude's",
                        "because entering a worktree is a harness tool call",
                    ):
                        self.assertNotIn(explanation, body)
            review = (self.bundle(target) / "SKILL.md").read_text()
            self.assertIn("Never widen", review)
            self.assertIn("unavailable, never approval", review)
            self.assertIn("stderr", review)
            if target == Target.PI:
                for instruction in (
                    "prepared values verbatim", "outputSchema", 'context: "fresh"',
                    "without polling", "captured `structured_output`",
                    "ignore any partial artifact", "temporary directory",
                ):
                    self.assertIn(instruction, review)

    @unittest.skipUnless(shutil.which("node"), "Node.js is needed for helper regression checks")
    def test_generated_helpers(self):
        for target in Target:
            with self.subTest(target=target):
                result = subprocess.run(
                    ["node", str(self.bundle(target) / "scripts/tests/test_run_review.mjs")],
                    text=True, capture_output=True, timeout=60,
                )
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
