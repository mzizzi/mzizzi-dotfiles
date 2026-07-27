# implement-plan branch/worktree resolution rework — Brainstorm

## The idea

Step 2 of the `/implement-plan` skill ("Prepare the feature branch") resolves where the implementation lands. Today it **always** creates a git worktree, and the instructions run ~70 lines split into Case A (three sub-cases for reusing existing feature work) and Case B (clean vs. dirty-carry-in-place creation). It's more machinery than the common case needs.

We want to flip the default and simplify:

- The default should be a plain branch off trunk — a worktree is now opt-in via a new `--worktree` flag.
- Existing feature work for the plan should be reused rather than re-created.
- The prose should shrink to just enough for Claude to execute cleanly, replacing the Case A/Case B structure with a single linear decision.

## Decisions

### Precedence — reuse vs. `--worktree`

- **Question:** When `--worktree` is passed but the plan already has a plain (non-worktree) branch from a prior round, what wins?
- **Decision:** Reuse wins — `--worktree` is ignored when feature work already exists.
- **Why:** Simplest mental model: reuse is checked first, and `--worktree` is purely the "how to create" switch for brand-new work. It sidesteps the messy "migrate an existing branch into a worktree mid-feature" path entirely (uncommitted work, a branch already checked out elsewhere), which has no clean implementation.

### Detection — what counts as "already has feature work"

- **Question:** What triggers the reuse path?
- **Decision:** A fuzzy/interpretive match. Reuse when a branch or worktree _appears_ to be for this plan; the canonical name is `<username>/<slug>`, but a strict match isn't required as long as the branch's intent clearly points at this plan. Being on an unrelated branch falls through to create-new.
- **Why:** Precise enough to tie reuse to _this_ plan rather than to being on any random non-trunk branch, but the user is comfortable letting the model interpret intent rather than demanding an exact string match — a manually-named-but-clearly-this-plan branch should still be reused.

### Branch base — what a new plain branch is cut from

- **Question:** What should a newly created plain branch be based off of?
- **Decision:** Remote-synced trunk. Fetch, then branch off `origin/<trunk>` (where `<trunk>` is whatever `origin/HEAD` resolves to — main or master), falling back to local `main`/`master` if there's no remote.
- **Why:** Reads "off main" as "off the trunk, current with remote." It's the same base logic the worktree path already uses (`worktree.baseRef` = `fresh`), so the plain-branch and worktree creation paths stay consistent and the branch doesn't start behind remote.

### Dirty working tree — how it's handled

- **Question:** How should a dirty tree be handled across the resolution paths?
- **Decision:** Abort, uniformly. If the working tree is dirty, stop and tell the user to commit/stash/move their changes, then re-run with a clean tree. No checkpoint-commit, no carry-in-place — every path requires a clean tree.
- **Why:** This is the single biggest source of the current verbosity (checkpoint-commit logic in Case A, the carry-in-place vs. abort fork in Case B). A hard "clean tree required" rule deletes all of it. The Step 4 Codex review needs a clean baseline diff anyway, so forcing the user to resolve pending changes up front is the honest precondition rather than something the skill papers over.

### Reuse mechanics — getting to the existing branch/worktree

- **Question:** How concise should the reuse actions be — keep the distinct git actions or flatten to "just reuse it"?
- **Decision:** Three tight, one-line bullets, one per physical situation: (a) already on the plan's branch/worktree → stay; (b) a worktree for it exists but you're not in it → `EnterWorktree` into it; (c) only the branch exists → `git switch` to it.
- **Why:** Each situation genuinely needs a different command — flattening to "enter it however's appropriate" risks the wrong action (e.g. `git switch` onto a branch already checked out in a worktree, which errors). But the guidance compresses to three lines rather than three paragraphs.

### Argument surface — the `--worktree` flag

- **Question:** How is `--worktree` surfaced and parsed?
- **Decision:** Accept a literal `--worktree` token anywhere in the skill's arguments; add `[--worktree]` to the `argument-hint` frontmatter; parse it in Step 1 alongside plan-path and scope. Creation reuses the existing `EnterWorktree` mechanism (base `origin/<trunk>` via `baseRef` = `fresh`) — only its trigger moves from "always" to "this flag is present."
- **Why:** A formal token is discoverable and predictable to invoke, and reflected in the argument-hint. The worktree creation code itself is unchanged, so this is a minimal, low-risk edit — just gating an existing path behind a flag.

## Resulting Step 2 logic (settled)

1. Derive branch name `<username>/<slug>`; gather git state (current branch, dirty status, trunk via `origin/HEAD`, existing worktrees, existing branch).
2. **Dirty tree → abort** with a message to clean up and re-run.
3. **Feature work for this plan already exists** (fuzzy match on branch/worktree, or already sitting on it) → **reuse**, via the three one-line actions above.
4. **Otherwise (new work):**
   - `--worktree` present → fetch, then `EnterWorktree(name: <username>/<slug>)`.
   - else → fetch, then `git switch -c <username>/<slug>` off `origin/<trunk>` (plain branch).
5. Announce the branch (and worktree path, when applicable); keep referencing the plan by its absolute path since entering a worktree changes the session cwd.
