---
name: review-pr
description: Review a pull request's pushed head read-only — the full fix-all sweep under --apply=none, run in a throwaway worktree — and report the findings without editing anything. Use when the user asks to review a PR by number or URL and wants a report rather than edits, e.g. "review PR 123".
argument-hint: <pr-number-or-url>
allowed-tools: Bash, Skill, EnterWorktree, ExitWorktree
disable-model-invocation: false
user-invocable: true
---

# Review PR

Review what GitHub has for a PR, with nothing changed in the user's checkout. The PR's head is checked out in a detached worktree, `fix-all` reviews it against the merge base, and the worktree is removed afterwards. Unpushed local work is out of scope; that is `fix-all pr --apply=none`.

Pass the argument to `gh pr view` unchanged.

First record `<start>` as `git rev-parse --show-toplevel` and `<root>`, the main checkout's root, as the parent directory of `git rev-parse --path-format=absolute --git-common-dir`. If any of steps 1–3 fails, stop and show its error.

1. `gh pr view <arg> --json number,baseRefName,headRefOid`.
2. `git fetch origin pull/<number>/head <baseRefName>`.
3. `git worktree add --detach <root>/.claude/worktrees/review-pr-<number> <headRefOid>`.
4. `EnterWorktree(path: <that path>)`.
5. `Skill(skill: "fix-all", args: "--apply=none --base origin/<baseRefName>")`.
6. Cleanup, without asking — it is part of what the user invoked. Once step 3 has created the worktree, run it whatever happened after:
   - Return to `<start>` (skip if step 4 failed): `ExitWorktree(action: "keep")` when `<start>` is `<root>`, otherwise `EnterWorktree(path: <start>)` — ExitWorktree would land in `<root>`.
   - `git worktree remove --force <path>`, run from `<start>`.

## Report

fix-all's report. If cleanup failed, say so and give the worktree path.
