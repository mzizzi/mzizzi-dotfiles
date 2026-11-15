from pathlib import Path
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[2]
SCRIPTS = [
    REPO / root / "skills/prepare-feature-branch/scripts/inspect_branch_state.sh"
    for root in (
        "ai/mzizzi",
        "plugins/mzizzi",
        "ai-rendered/claude/plugins/mzizzi",
        "ai-rendered/pi/packages/mzizzi",
    )
]


class PrepareFeatureBranchTests(unittest.TestCase):
    def test_email_username_and_existing_branch(self):
        cases = (
            ("354423602+super-crispy@users.noreply.github.com", "super-crispy"),
            ("super-crispy@users.noreply.github.com", "super-crispy"),
            ("mhzizzi@gmail.com", "mhzizzi"),
            ("354423602+super-crispy@example.com", "354423602+super-crispy"),
            ("name+tag@users.noreply.github.com", "name+tag"),
            ("354423602+super-crispy@users.noreply.github.com.example.com",
             "354423602+super-crispy"),
        )
        with tempfile.TemporaryDirectory(prefix="branch email test ") as directory:
            repo = Path(directory)

            def git(*args):
                subprocess.run(
                    ["git", *args], cwd=repo, check=True, capture_output=True, text=True,
                )

            git("init", "-b", "main")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.com")
            git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-m", "Fixture")
            plan = repo / "plans/20261115-email-username"
            plan.mkdir(parents=True)

            for script in SCRIPTS:
                for email, username in cases:
                    with self.subTest(script=script.relative_to(REPO), email=email):
                        git("config", "user.email", email)
                        branch = f"{username}/email-username"
                        git("branch", branch)
                        try:
                            result = subprocess.run(
                                ["bash", str(script), str(plan)], cwd=repo,
                                check=True, capture_output=True, text=True,
                            )
                            state = dict(line.split("=", 1) for line in result.stdout.splitlines())
                            self.assertEqual(state["USERNAME"], username)
                            self.assertEqual(state["BRANCH"], branch)
                            self.assertEqual(state["ACTION"], "switch")
                        finally:
                            git("branch", "-D", branch)
