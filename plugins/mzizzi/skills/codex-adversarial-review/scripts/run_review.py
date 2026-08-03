#!/usr/bin/env python3
"""Run a Codex adversarial review by invoking the codex plugin's companion script directly.

Usage: run_review.py "<focus/scope text, same as /codex:adversarial-review>"

See ../SKILL.md for why this bypasses /codex:adversarial-review and what the exit codes
mean to a caller.
"""

import json
import subprocess
import sys
from pathlib import Path

focus_args = sys.argv[1] if len(sys.argv) > 1 else ""
installed_json = Path.home() / ".claude" / "plugins" / "installed_plugins.json"

# Absent file, malformed JSON and a missing entry all mean the same thing to the caller.
try:
    plugins = json.loads(installed_json.read_text(encoding="utf-8"))["plugins"]
    install_path = plugins["codex@openai-codex"][0]["installPath"]
except (OSError, ValueError, LookupError):
    install_path = None

if not install_path:
    print(
        f"CODEX_NOT_INSTALLED: the openai-codex plugin isn't installed "
        f"(no codex@openai-codex entry in {installed_json}).",
        file=sys.stderr,
    )
    sys.exit(2)

script = Path(install_path) / "scripts" / "codex-companion.mjs"
if not script.is_file():
    print(
        f"CODEX_NOT_INSTALLED: codex-companion.mjs not found at expected path: {script}",
        file=sys.stderr,
    )
    sys.exit(2)

# Captured rather than streamed: the companion can render a partial report before it
# settles on a failing status, and its stderr is progress noise unless the run fails.
completed = subprocess.run(
    ["node", str(script), "adversarial-review", focus_args],
    capture_output=True,
)

if completed.returncode != 0:
    sys.stderr.buffer.write(completed.stderr)
    sys.exit(completed.returncode)

# Never decoded, so a report full of em dashes survives a non-UTF-8 console.
sys.stdout.buffer.write(completed.stdout)
