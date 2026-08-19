---
name: prepare-feature-branch
description: "Put a plan's implementation work onto a <username>/<slug> feature branch, reusing the branch if it exists, and commit the plan document onto it. The source of truth for that naming convention. Use when work against a plan directory needs somewhere to land."
argument-hint: "<plan directory or plan.md>"
allowed-tools: Bash, EnterWorktree, AskUserQuestion
disable-model-invocation: false
user-invocable: true
---

# Prepare Feature Branch

Get the working tree onto the right branch for a plan before any code is written, so the resulting diff maps back to the plan and never lands on the trunk.

This is the single source of truth for the branch-naming convention. That matters beyond tidiness: a plan is usually implemented over several runs, and every run has to derive the _same_ name from the plan directory or it forks a second branch instead of continuing the first. Deriving it in one place is what makes those runs agree.

## Convention

    <username>/<slug>

- `<username>` — local-part of `git config user.email` (`mhzizzi@gmail.com` → `mhzizzi`)
- `<slug>` — plan directory basename with the leading `yyyymmdd-` stamp stripped (`20260713-oauth-token-refresh` → `oauth-token-refresh`)

The same string names the worktree, when the branch already lives in one.

## Step 1: Inspect

Run the bundled script with the plan directory (a path to `plan.md` works too — it resolves to the parent directory):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/prepare-feature-branch/scripts/inspect_branch_state.sh" plans/20260713-oauth-token-refresh
```

It derives the branch name, gathers the git state, and prints `KEY=value` lines ending in a recommended `ACTION`. It only reports — it never switches, creates, or commits, because entering a worktree is a harness tool call rather than a shell command, and because a script that both decides and acts is harder to override when its recommendation is wrong.

Uncommitted changes are classified in the script, not here: the plan directory this run is about is reported as `PLAN_DIR_DIRTY`, everything else as `OTHER_DIRTY` with a count and the porcelain lines, so there is no judgment call left for you at this step. `ACTION` covers only where the branch comes from; pending edits are separate state that Step 2 settles.

`ACTION` is one of `stay`, `enter-worktree`, `switch`, `judge-current-branch-then-create`, or `create`. On failure it prints an `ERROR=` line instead (not a git repository, no such path, no configured `user.email`) — report that to the user rather than working around it.

## Step 2: Settle any pending edits

Skip this entirely when `OTHER_DIRTY=no`, which is the common case — and also when `ACTION=enter-worktree`, since the edits stay behind in this working tree and the worktree's diff is clean either way.

Otherwise the user has work in progress outside the plan directory, and it has to go somewhere before implementation starts — pending edits left in place get attributed to the implementation by whatever reviews the working-tree diff afterward. Which destination is right depends on whether that work belongs with this plan, and only the user knows. Put it to them with `AskUserQuestion`, listing the reported paths so they can decide from the question itself:

- **Commit onto the feature branch** — carried across the switch and committed there before implementation starts, as its own commit. Right when the edits are groundwork for this plan.
- **Commit where you are** — committed on the current branch first, before branching. Right when the edits are unrelated and belong on the trunk.
- **Stash** — set aside for the user to restore later.
- **Leave them** — proceed with a mixed diff, accepting that the review passes will see the edits as part of the implementation.

Recommend the first when the paths look like groundwork for this plan and the second when they don't; say which you think it is in one line. Carry out the answer at the point it applies — "commit where you are" happens before Step 3, "commit onto the feature branch" after it. On `stay` those two are the same commit, so offer it once.

Never stash without being asked to. A stash is silent and easy to forget, so it's a fine answer from the user and a bad guess on their behalf.

## Step 3: Act on the recommendation

**`stay`** — already on the branch. Nothing to do.

**`enter-worktree`** — the branch lives in a worktree elsewhere: `EnterWorktree(path: <WORKTREE_PATH>)`.

**`switch`** — the branch exists in this working tree: `git switch <BRANCH>`.

**`judge-current-branch-then-create`** — the conventionally-named branch doesn't exist, but you're sitting on some _other_ non-trunk branch, and it might be hand-named feature work for this same plan. Decide before doing anything else:

- It's for this plan (e.g. `feat/oauth-refresh` when the plan is `20260713-oauth-token-refresh`) → stay on it. One piece of work shouldn't span two branches.
- It's unrelated → `git switch -c <BRANCH> <TRUNK>`, weighing `TRUNK_BEHIND` first as in `create` below. Name the local trunk explicitly here: `HEAD` is the unrelated branch, so it's the one case where the base isn't where you're standing.

The script hands you this call rather than making it because it can compare strings but can't tell that two differently-worded names describe the same effort. If it's genuinely ambiguous, ask the user — landing a plan's implementation on somebody else's in-progress branch is annoying to unpick.

**`create`** — no feature work for this plan exists and you're on the trunk. The script has already fetched, so `TRUNK_BEHIND` says how many commits the local trunk is missing from `<REMOTE>/<TRUNK>`:

- Greater than zero → say so and ask whether to update the trunk first (`git pull --ff-only`) before branching. Only the user knows whether those commits matter to this plan, and starting from a stale base is tedious to unpick later.
- Zero, or `REMOTE` is empty → nothing to weigh.

Then `git switch -c <BRANCH>`, basing the branch on local `HEAD` rather than `<REMOTE>/<TRUNK>`: local commits the remote hasn't seen belong in the branch, and this user pushes at session end, so the remote is routinely behind.

## Step 4: Commit the plan document

When `PLAN_DIR_DIRTY=yes`, commit the plan directory now that you're on the feature branch:

```bash
git add <plan dir> && git commit -m "plan: <SLUG>"
```

On the branch rather than the trunk, so the plan travels with the implementation it describes and the trunk is left untouched. A markdown formatting hook may rewrite the files and fail the commit; re-run the `git add` and `git commit` once and it lands.

Name the plan directory explicitly rather than staging everything: if the user chose to leave their pending edits in place at Step 2, `git add -A` would sweep them into the plan commit.

## Step 5: Announce

Report the branch and, when in a worktree, its path — and whether it was reused or created, plus the plan commit if you made one and what became of any pending edits. Callers put this in their summary so the work is easy to find for review, and the distinction tells the user whether they're adding to existing work or starting fresh.

Two things worth passing on when a worktree is involved: the session cwd changed, so any path the caller resolved earlier (the plan document especially) should keep being referenced by its original absolute path; and the worktree persists after the session — on exit the harness offers to keep or remove it, and keeping it preserves the work for review.
