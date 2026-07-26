---
name: prepare-feature-branch
description: Put implementation work for a plan onto its own feature branch (optionally an isolated git worktree), reusing the branch if it already exists — the single source of truth for the <username>/<slug> branch-naming convention. Use this whenever work is about to start against a plan directory and needs somewhere to land: the implement-plan and implement-plan-complex skills call it before writing any code, and you can invoke it directly whenever the user wants a branch or worktree set up for a plan.
argument-hint: <plan directory or plan.md> [--worktree]
allowed-tools: Bash, EnterWorktree
---

# Prepare Feature Branch

Get the working tree onto the right branch for a plan before any code is written, so the resulting diff maps back to the plan and never lands on the trunk.

This is the single source of truth for the branch-naming convention. That matters beyond tidiness: `implement-plan-complex` prepares the branch once and then spawns per-phase sub-agents that each run `implement-plan`, which prepares the branch again. Those two have to derive the *same* name or every phase forks its own branch. One skill deriving it in one place is what makes them agree.

## Convention

    <username>/<slug>

- `<username>` — local-part of `git config user.email` (`mhzizzi@gmail.com` → `mhzizzi`)
- `<slug>` — plan directory basename with the leading `yyyymmdd-` stamp stripped (`20260713-oauth-token-refresh` → `oauth-token-refresh`)

The same string names the worktree when one is used.

## Step 1: Inspect

Run the bundled script with the plan directory (a path to `plan.md` works too — it resolves to the parent directory):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/prepare-feature-branch/scripts/inspect_branch_state.sh" plans/20260713-oauth-token-refresh
```

It derives the branch name, gathers the git state, and prints `KEY=value` lines ending in a recommended `ACTION`. It only reports — it never switches or creates, because entering a worktree is a harness tool call rather than a shell command, and because a script that both decides and acts is harder to override when its recommendation is wrong.

`ACTION` is one of `abort-dirty-tree`, `stay`, `enter-worktree`, `switch`, `judge-current-branch-then-create`, or `create`. On failure it prints an `ERROR=` line instead (not a git repository, no such path, no configured `user.email`) — report that to the user rather than working around it.

## Step 2: Act on the recommendation

**`abort-dirty-tree`** — stop and tell the user to commit, stash, or move their changes and re-run clean. Don't stash on their behalf. A clean baseline isn't bureaucratic here: callers like `implement-plan` hand their working-tree diff to a review tool, so pre-existing edits would be attributed to the implementation.

**`stay`** — already on the branch. Nothing to do.

**`enter-worktree`** — the branch lives in a worktree elsewhere: `EnterWorktree(path: <WORKTREE_PATH>)`.

**`switch`** — the branch exists in this working tree: `git switch <BRANCH>`.

**`judge-current-branch-then-create`** — the conventionally-named branch doesn't exist, but you're sitting on some *other* non-trunk branch, and it might be hand-named feature work for this same plan. Decide before doing anything else:

- It's for this plan (e.g. `feat/oauth-refresh` when the plan is `20260713-oauth-token-refresh`) → stay on it. One piece of work shouldn't span two branches.
- It's unrelated → create the new branch off the trunk, as below.

The script hands you this call rather than making it because it can compare strings but can't tell that two differently-worded names describe the same effort. If it's genuinely ambiguous, ask the user — landing a plan's implementation on somebody else's in-progress branch is annoying to unpick.

**`create`** — no feature work for this plan exists and you're on the trunk. Fetch first so the base is current (skip when `REMOTE` is empty), then:

- `--worktree` given → `EnterWorktree(name: "<BRANCH>")`, which creates the branch and an isolated worktree off `<REMOTE>/<TRUNK>`. Read the real branch name back with `git rev-parse --abbrev-ref HEAD` afterward, since the harness may adjust it.
- otherwise → `git switch -c <BRANCH> <REMOTE>/<TRUNK>` (use the local `<TRUNK>` when there's no remote).

`--worktree` applies only to brand-new feature work. When the branch or worktree already exists, reuse it and ignore the flag — the point of the flag is isolating a fresh effort, not relocating one in progress.

## Step 3: Announce

Report the branch and, when in a worktree, its path — and whether it was reused or created. Callers put this in their summary so the work is easy to find for review, and the distinction tells the user whether they're adding to existing work or starting fresh.

Two things worth passing on when a worktree is involved: the session cwd changed, so any path the caller resolved earlier (the plan document especially) should keep being referenced by its original absolute path; and the worktree persists after the session — on exit the harness offers to keep or remove it, and keeping it preserves the work for review.
