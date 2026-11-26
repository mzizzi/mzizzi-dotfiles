from datetime import datetime
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import yaml

RENDERER = Path(__file__).resolve().parent.parent
REPO = RENDERER.parent
sys.path.insert(0, str(RENDERER))
from render_ai import Target, build


def skill_document(path):
    _, frontmatter, body = path.read_text().split("---", 2)
    return yaml.safe_load(frontmatter), body


class PilotSkillTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ai-pilots-")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name)
        shutil.copytree(REPO / "ai", self.repo / "ai")
        build(self.repo)

    def skill_output(self, target, name):
        package_type = "plugins" if target == Target.CLAUDE else "packages"
        return self.repo / "ai-rendered" / target / package_type / "mzizzi/skills" / name

    def test_plan_script_uses_nearest_plans_and_is_repeatable(self):
        (self.repo / "plans").mkdir()
        for target in Target:
            work = self.repo / f"{target} work"
            subprocess.run(["git", "init", str(work)], check=True, capture_output=True)
            nested = work / "src/deep"
            nested.mkdir(parents=True)
            script = self.skill_output(target, "create-plan-dir") / "scripts/create_plan_dir.sh"
            cases = (
                ("fallback", nested, work / ".nocommit/plans"),
                ("repository plans", nested, work / "plans"),
                ("nearest plans", nested, work / "src/plans"),
                ("current plans", nested, nested / "plans"),
                ("root ignores descendants", work, work / "plans"),
            )
            for label, cwd, base in cases:
                with self.subTest(target=target, layout=label):
                    if label != "fallback":
                        base.mkdir(exist_ok=True)
                    stamps = {datetime.now().strftime("%Y%m%d")}
                    outputs = []
                    for _ in range(2):
                        result = subprocess.run(
                            ["bash", str(script), "  OAuth TOKEN refresh!!  "],
                            cwd=cwd, capture_output=True, text=True, check=True,
                        )
                        self.assertEqual(result.stderr, "")
                        self.assertEqual(len(result.stdout.splitlines()), 1)
                        outputs.append(Path(result.stdout.strip()))
                    stamps.add(datetime.now().strftime("%Y%m%d"))
                    for output in outputs:
                        self.assertTrue(output.is_absolute())
                        self.assertEqual(output.parent, base)
                        self.assertIn(output.name, {f"{stamp}-oauth-token-refresh" for stamp in stamps})
                        self.assertTrue(output.is_dir())
                    if len(stamps) == 1:
                        self.assertEqual(outputs[0], outputs[1])

    def test_plan_script_rejects_invalid_topics_and_non_repositories(self):
        work = self.repo / "work"
        subprocess.run(["git", "init", str(work)], check=True, capture_output=True)
        cases = (
            (work, [], "provide a short description"),
            (work, [""], "provide a short description"),
            (work, ["!!!"], "did not yield a usable slug"),
            (self.repo, ["Valid topic"], "not inside a git repository"),
        )
        for target in Target:
            script = self.skill_output(target, "create-plan-dir") / "scripts/create_plan_dir.sh"
            for cwd, arguments, message in cases:
                with self.subTest(target=target, arguments=arguments, cwd=cwd):
                    result = subprocess.run(
                        ["bash", str(script), *arguments], cwd=cwd, capture_output=True, text=True,
                    )
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, "")
                    self.assertIn(message, result.stderr)
            self.assertFalse((work / ".nocommit").exists())
            self.assertFalse((self.repo / ".nocommit").exists())


if __name__ == "__main__":
    unittest.main()
