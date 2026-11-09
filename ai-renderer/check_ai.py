#!/usr/bin/env python3
"""Check that Git's AI candidate contains the exact rendered packages."""

import argparse
import os
from pathlib import Path
import subprocess
import sys
from typing import Sequence

from render_ai import RenderError, build


RELEVANT_PATHS = (
    "ai/", "ai-rendered/", "ai-renderer/render_ai.py", "ai-renderer/check_ai.py",
    "ai-renderer/requirements.txt", ".pre-commit-config.yaml", ".prettierrc",
    ".prettierignore", ".markdownlint-cli2.yaml", ".gitattributes", ".gitignore",
)


def git(repo_root: Path, *args: str) -> list[str]:
    command = ["git", "--no-optional-locks", "-c", "diff.autoRefreshIndex=false"]
    if sys.platform != "win32":
        command += ["-c", "core.filemode=true"]
    result = subprocess.run(
        [*command, *args], cwd=repo_root, capture_output=True,
    )
    if result.returncode:
        detail = os.fsdecode(result.stderr).strip()
        raise RenderError(f"Git candidate check failed ({' '.join(args[:2])}): {detail}")
    return [os.fsdecode(item) for item in result.stdout.split(b"\0") if item]


def check_git_state(repo_root: Path, *, push: bool = False) -> list[str]:
    errors = []
    for entry in git(repo_root, "ls-files", "-v", "-z", "--", *RELEVANT_PATHS):
        flag, path = entry[0], entry[2:]
        if flag.islower() or flag.upper() == "S":
            errors.append(
                f"{path!r}: unsupported assume-unchanged/skip-worktree index flag; "
                "clear it with git update-index --no-assume-unchanged --no-skip-worktree -- <path>"
            )
    for path in git(repo_root, "ls-files", "--others", "-z", "--", *RELEVANT_PATHS):
        errors.append(f"{path!r}: untracked AI file (including ignored files); stage the intended file or remove it")
    # Unlike --name-only, --numstat compares content even when stat data is stale,
    # without needing to refresh the index. Disable renames for one path per record.
    diff_options = ("--no-ext-diff", "--no-textconv", "--no-renames", "--numstat", "-z")
    for entry in git(repo_root, "diff", *diff_options, "--", *RELEVANT_PATHS):
        path = entry.split("\t", 2)[2]
        errors.append(f"{path!r}: relevant worktree file differs from the index; stage or restore it before checking")
    if push:
        for entry in git(repo_root, "diff", "--cached", *diff_options, "HEAD", "--", *RELEVANT_PATHS):
            path = entry.split("\t", 2)[2]
            errors.append(f"{path!r}: push candidate differs from HEAD; commit the intended source and output before pushing")
    return errors


def check(repo_root: Path, *, push: bool = False) -> list[str]:
    errors = check_git_state(repo_root, push=push)
    if errors:
        return errors
    changes = build(repo_root, check=True)
    if changes:
        return [*changes, "Run python ai-renderer/render_ai.py, review, and stage the intended source and output; then retry."]
    return []


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--push", action="store_true", help="Also require relevant index files to match HEAD.")
    args = parser.parse_args(argv)
    try:
        errors = check(Path(__file__).resolve().parent.parent, push=args.push)
    except (RenderError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    if errors:
        print("AI candidate check failed:\n" + "\n".join(errors), file=sys.stderr)
        return 1
    print("AI candidate and rendered output are current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
