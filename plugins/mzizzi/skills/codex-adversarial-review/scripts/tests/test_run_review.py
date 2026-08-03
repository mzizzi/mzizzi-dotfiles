#!/usr/bin/env python3
"""Regression checks for run_review.py's failure contract: the underlying script's exit
status must propagate, stdout must be released only on success, stderr only on failure.

Usage: python test_run_review.py     (exits non-zero if any case fails)
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

script = Path(__file__).resolve().parents[1] / "run_review.py"

with tempfile.TemporaryDirectory() as tmp:
    work = Path(tmp)

    # A fake home so plugin resolution succeeds and the run reaches the part under test.
    fake_home = work / "home"
    # A real .mjs run by the real node, not a stub `node` earlier on PATH: Windows
    # CreateProcess appends only .exe and never consults PATHEXT, so a stub is skipped.
    companion = fake_home / "plug" / "scripts" / "codex-companion.mjs"
    companion.parent.mkdir(parents=True)
    (fake_home / ".claude" / "plugins").mkdir(parents=True)
    (fake_home / ".claude" / "plugins" / "installed_plugins.json").write_text(
        json.dumps({"plugins": {"codex@openai-codex": [{"installPath": str(companion.parents[1])}]}}),
        encoding="utf-8",
    )

    env = dict(os.environ)
    # Path.home() reads USERPROFILE on Windows and HOME everywhere else, so both point at
    # the fake home to keep this test platform-agnostic.
    env["HOME"] = env["USERPROFILE"] = str(fake_home)

    fails = 0
    for code in (0, 1, 2, 7):
        # Writes to stdout *before* failing, mimicking the companion rendering a partial
        # report and only then settling on a non-zero status.
        companion.write_text(
            f'process.stdout.write("REPORT BODY (stub exit {code})\\n");\n'
            f'process.stderr.write("stub diagnostic for exit {code}\\n");\n'
            f"process.exit({code});\n",
            encoding="utf-8",
        )

        completed = subprocess.run(
            [sys.executable, str(script), "--scope auto test"],
            capture_output=True,
            text=True,
            env=env,
        )
        out = completed.stdout.strip()
        err = completed.stderr.strip()

        want_out = f"REPORT BODY (stub exit {code})" if code == 0 else ""
        want_err = "" if code == 0 else f"stub diagnostic for exit {code}"

        ok = completed.returncode == code and out == want_out and err == want_err
        fails += not ok

        print(
            f"underlying exit {code:<2} -> wrapper {completed.returncode:<2}  "
            f"stdout={'nonempty' if out else 'empty':<9} "
            f"stderr={'nonempty' if err else 'empty':<9} "
            f"[{'yes' if ok else 'no'}]"
        )

print()
if fails:
    sys.exit(f"FAIL: {fails} case(s)")
print("PASS")
