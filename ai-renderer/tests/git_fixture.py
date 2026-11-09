import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest

from test_render_ai import REPO
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
            {path.relative_to(self.repo): (path.read_bytes(), stat.S_IMODE(path.stat().st_mode))
             for path in (self.repo / "ai-rendered").rglob("*") if path.is_file()},
        )

    def commit(self, message="Candidate", *, success=True):
        return self.git("commit", "--allow-empty", "-m", message, success=success)
