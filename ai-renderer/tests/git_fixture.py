import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from renderer_test_support import REPO, snapshot_files
from render_ai import build


class GitFixture(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ai candidate with spaces ")
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name) / "checkout"
        self.repo.mkdir()
        for name in (".pre-commit-config.yaml", ".prettierrc", ".prettierignore",
                     ".markdownlint-cli2.yaml", ".gitattributes", ".gitignore"):
            shutil.copy2(REPO / name, self.repo / name)
        (self.repo / "ai-renderer").mkdir()
        for name in ("render_ai.py", "check_ai.py", "requirements.txt"):
            shutil.copy2(REPO / "ai-renderer" / name, self.repo / "ai-renderer" / name)
        self.template = self.repo / "ai/example/skills/demo/SKILL.md.j2"
        self.template.parent.mkdir(parents=True)
        shutil.copy2(REPO / "ai/models.json", self.repo / "ai/models.json")
        self.template.write_text("---\ndescription: Candidate fixture.\n---\n\n# Demo\n\nOriginal.\n")
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.com")
        build(self.repo)
        self.git("add", ".")
        self.output = self.repo / "ai-rendered/pi/packages/example/skills/demo/SKILL.md"

    def git(self, *args, success=True, env=None):
        result = subprocess.run(
            ["git", *args], cwd=self.repo, text=True, capture_output=True,
            env={**os.environ, **(env or {})},
        )
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def snapshot(self):
        return (
            self.git("write-tree").stdout,
            (self.repo / ".git/index").read_bytes(),
            snapshot_files(self.repo / "ai-rendered", relative_to=self.repo),
        )

    def commit(self, message="Candidate", *, success=True):
        return self.git("commit", "--allow-empty", "-m", message, success=success)
