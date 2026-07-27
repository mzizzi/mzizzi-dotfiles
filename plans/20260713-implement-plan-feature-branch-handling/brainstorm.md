# implement-plan: feature-branch creation & dirty-tree handling — Brainstorm

## The idea

Change the `mzizzi:implement-plan` skill so it isolates each implementation onto its own feature branch and handles a dirty working tree deliberately, instead of implementing in place. Today the skill's Step 1 only checks `git status --porcelain` and, if the tree is dirty, offers a single checkpoint commit — there is no branch handling at all, so an implementation can land directly on `main`. The skill deliberately leaves changes uncommitted because the downstream Codex adversarial review reads the working-tree diff, so any git prep must preserve a clean, implementation-only diff for that review.

Two headline asks drove the interview:

1. Always create a branch off main/master for the feature being worked on.
2. Ask the user what to do when there are uncommitted changes.

The grilling narrowed "always" (which breaks down in the phased workflow) and worked out how the two asks collide at the git-mechanics level.

**Scope:** all changes described here land in **Step 1** of the implement-plan skill (`plugins/mzizzi/skills/implement-plan/SKILL.md`) — today's "Step 1: Checkpoint any pending work". That step is replaced by the branch-creation + dirty-tree logic below. Because the branch name derives from the plan directory, the git-prep work must run _after_ the plan target is resolved (today's Step 2), so the step ordering is expected to change as part of this work (see Open questions).

## Decisions

### When to create a branch

- **Question:** Should the skill always branch off main, or only when currently on main/master?
- **Decision:** Only branch when HEAD is on main/master. If already on a non-main branch, assume it's the feature branch and continue there (don't cut a new one).
- **Why:** The skill supports phased implementation (run phase 1, then later phase 2). If phase 1 created a feature branch and committed, re-running for phase 2 must continue on that branch — branching off main again would strand phase 1's commits. Keying off "on main/master" still guarantees a feature is never built directly on main, while making the phased workflow correct. The user added a rider: before branching, ensure main/master is current with its remote (see next decision).

### Bringing main up to date before branching

- **Question:** When the skill tries to fast-forward main from its remote and can't do so cleanly (no remote/offline, or local main diverged), what should it do?
- **Decision:** Attempt a fast-forward. If it can't be done cleanly — or would destroy local changes — stop and ask the user how to proceed. Don't silently branch off a stale or diverged base.
- **Why:** The user wants the feature branch based on an up-to-date main, so a failed fast-forward is a real signal, not noise. A diverged main (e.g. commits made directly on main locally) or a fast-forward that would clobber local work is exactly the situation where a wrong guess is costly, so hand the decision back to the user rather than pick.

### Dirty-tree menu

- **Question:** When the working tree is dirty, what options should the skill present?
- **Decision:** Exactly two options — (a) carry the changes onto the new feature branch and checkpoint-commit them, or (b) abort and let the user handle it manually, then re-run. No stash option, no discard option.
- **Why:** Carry-and-commit keeps main clean, preserves the in-flight work, and gives the Codex review a clean baseline (the implementation diff sits on top of the checkpoint commit rather than mixing with pre-existing changes). Abort is the zero-magic escape hatch when the dirty changes don't belong with this feature. Stash was rejected as a user-facing choice because it would leave changes uncommitted on the branch and re-muddy the review diff; discard is destructive and rarely wanted.

### Branch-name — username source

- **Question:** The branch name is `<username>/<short-feature-name>`. Where does `<username>` come from?
- **Decision:** The local-part of `git config user.email` (e.g. `mhzizzi@gmail.com` → `mhzizzi`, giving `mhzizzi/oauth-token-refresh`).
- **Why:** Automatic and travels with whoever's git identity is configured — no hardcoded identity baked into a shared dotfiles skill. The user explicitly preferred the email local-part over `git config user.name` (which would yield `mzizzi`).

### Branch-name — format & confirmation

- **Question:** Given a proposed name, confirm with the user before creating, or auto-create?
- **Decision:** Format is `<username>/<short-feature-name>`, where `<short-feature-name>` is the plan-directory slug (date prefix stripped, e.g. `20260713-oauth-token-refresh` → `oauth-token-refresh`). Auto-create the branch with no confirmation prompt.
- **Why:** The plan slug makes the derived name almost always right, and the user prefers fewer interruptions. A wrong name can be renamed after the fact.

### Reconciling "up-to-date main" with carrying a dirty tree

- **Question:** In the dirty + carry-and-commit path, "fast-forward main" wants a clean tree but "carry these changes" means it's dirty. How to reconcile?
- **Decision:** When carrying dirty changes, create the branch off _current local_ main, carry the changes onto it, and checkpoint-commit — skip the remote fast-forward for that run, and note to the user that the base may be slightly behind. The remote-sync guarantee applies to the clean path (the common one).
- **Why:** Avoids stash/rebase gymnastics and the risk of a stash-pop conflicting against a freshly-updated main. Keeping the dirty path simple and predictable is worth accepting a possibly-slightly-stale base for that less-common case, as long as it's surfaced.

### Branch-name collision

- **Question:** If the derived branch already exists when the skill goes to create it (you're on main, but the feature branch is already there from a prior run), what happens?
- **Decision:** Don't prompt — automatically pick a branch name that doesn't conflict by appending a numeric suffix (e.g. `mhzizzi/oauth-token-refresh-2`, then `-3`, …) until the name is free, then create that branch off main.
- **Why:** Keeps branch creation non-interactive (consistent with the auto-create, no-confirm naming decision). Guarantees the create never fails on a collision, and the emitted branch-name message (see next decision) tells the user exactly which branch was chosen so a variant is never a surprise. (A dirty tree is still handled per the menu above.)
  - _Amends an earlier interview answer_ that would have asked the user to choose between switching to the existing branch and a new variant; the user revised this to the non-interactive auto-variant behavior.

### Emit the chosen branch name

- **Question:** Should the skill surface which branch it's working on?
- **Decision:** Yes — emit a message stating the chosen branch name at two points: (1) at branch-selection time (when the branch is created or when continuing on an existing feature branch), and (2) again in the final output summary at the end of the skill.
- **Why:** The branch is auto-derived and auto-created with no confirmation, and a collision may silently produce a variant name — so the user needs to see which branch the work actually landed on, both up front (to catch a wrong branch early) and at the end (so the summary is self-contained and the branch is easy to find for review/PR).

## Open questions

Threads surfaced but not resolved in the interview — settle during planning/implementation:

- **Trunk-name detection.** How the skill identifies the trunk branch (main vs master vs something else). Reasonable approach: resolve via `origin/HEAD`, fall back to whichever of `main`/`master` exists. Mechanical, not a design decision — confirm during planning.
- **Ordering / skill restructure.** The branch name derives from the plan directory, so the git-prep step must run _after_ the plan target is resolved (today's Step 2). This reorders Step 1 (currently the dirty-tree checkpoint) relative to target resolution — the plan should lay out the new step sequence explicitly.
- **Already on a feature branch with a dirty tree.** When continuing on an existing feature branch (not creating one), the "carry onto branch" framing is moot. Confirm the dirty-tree handling in that case collapses to checkpoint-commit-or-abort (essentially today's Step 1 behavior).
