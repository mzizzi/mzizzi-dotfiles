---
name: review-pr
description: Review a pull request's pushed head read-only — the full fix-all sweep under --apply=none, run in a throwaway worktree — and report the findings without editing anything. Use when the user asks to review a PR by number or URL and wants a report rather than edits, e.g. "review PR 123".
disable-model-invocation: false
---

Resolve `<skill-dir>` to this skill's absolute directory. Worktree entry/return needs the worktree extension in an interactive parent session; stop if unavailable.

# Review PR

Review what GitHub has for a PR, with nothing changed in the user's checkout. The PR's head is checked out in a detached worktree, `fix-all` reviews it against the merge base, and the worktree is removed afterwards. Unpushed local work is out of scope; that is `fix-all pr --apply=none`.

Pass the argument to `gh pr view` unchanged.

First record `<start>` as `git rev-parse --show-toplevel` and `<root>`, the main checkout's root, from the primary entry in `git worktree list --porcelain -z`. Do not derive it from the common Git directory's parent. If any of steps 1–3 fails, stop and show its error.

1. `gh pr view <arg> --json number,baseRefName,headRefOid`.
2. `git fetch origin pull/<number>/head <baseRefName>`.
3. `git worktree add --detach <root>/.claude/worktrees/review-pr-<number> <headRefOid>`.
4. Call `EnterWorktree({path:"<that path>"})` alone, with no outstanding child work. Retain `bindingWasActive` from its result. Wait for completed entry before review; on failure, skip review.
5. Read and follow the `fix-all` skill at `<skill-dir>/../fix-all/SKILL.md` with arguments `--apply=none --base origin/<baseRefName>`. Return here afterward.
6. After all reviewers finish, clean up even if review failed:
   - If entry completed, return alone: `EnterWorktree({path:"<start>"})` when `bindingWasActive`, otherwise `ExitWorktree({action:"keep"})`. Wait for completed return. If return fails, keep the review checkout and report it.
   - Run `git worktree remove <path>` from the starting checkout. If Git refuses or review left edits, keep/report the checkout or ask for discard approval. Never force removal without approval.

## Report

fix-all's report. If cleanup failed, say so and give the worktree path.
