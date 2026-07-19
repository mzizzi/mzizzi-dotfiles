---
name: implement-plan
description: Implement a technical plan produced by /create-plan — turn a plan.md (or a subset of it) into working code, then run a Codex adversarial review of the changes and triage the findings. Use this skill whenever the user wants to build out, execute, or implement an existing plan, or says things like "implement the plan in plans/…", "let's build phase 1 of this plan", "execute plan.md", or points at a plan directory and says "go". Prefer this over ad-hoc implementation whenever a plan document already exists — it keeps the diff reviewable and folds deferred review findings back into the plan.
argument-hint: <plan directory or plan.md> [subset to implement, e.g. "phase 1"]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent, AskUserQuestion, Skill, TaskCreate, TaskUpdate, TaskList
disable-model-invocation: false  # explicitly model-invokable (the default; stated so it can't silently drift)
user-invocable: true             # explicitly available as an /implement-plan slash command
---

# Implement Plan

Take a plan document (the output of the /create-plan skill) and turn it into working code, then subject the resulting changes to a Codex adversarial review and triage what it finds. The goal is a clean, reviewable implementation whose diff maps back to the plan, with review findings either fixed inline or recorded in the plan for follow-up.

Work through the steps below in order, tracking them with the task list seeded in Step 0 — the review-and-triage tail is easy to skip once the code is working, but it's where most of the value is.

## Step 0: Create the task list

Before doing anything else — before even opening the plan document — seed a tracked task list with the harness task tools (TaskCreate/TaskUpdate/TaskList). Create one item per numbered step of this skill: resolve target and scope, prepare the feature branch, implement (a placeholder — expanded below), Codex review, triage, apply trivial fixes, record follow-ups, review comments, summarize. Seeding the full skeleton first is what protects the tail: those steps exist as pending items from minute one, so finishing the code doesn't end the run — the list still shows open work. Creating the list must not wait on Step 1; an unconditional first action can't be preempted by scope questions going sideways.

**Expansion:** once Step 1 resolves the scope, replace the implement placeholder with the real work items — one per file entry the in-scope `### Implementation Phase <N>` sections list, in plan order, grouping only where the plan itself groups tightly-coupled files, with each entry's testing notes folded into its item. The plan's own enumeration is the source of granularity; don't re-judge it per run.

**Status discipline:**
* Exactly one of *this run's* items in progress at a time: mark an item in progress when you start the step and completed immediately when it's done — never batch-complete at the end. The invariant covers only items this invocation created; if the session already has unrelated tasks, add this skill's items alongside and never change the unrelated tasks' statuses.
* Never end the turn with this run's items pending unless the run genuinely stopped short — the user redirected or aborted, or execution is blocked (failing verification, an unavailable dependency, a tool error you can't resolve). In those cases annotate the current item with the blocker and leave it and everything downstream pending; pending is the honest state for unfinished work.
* If a step becomes moot mid-run (e.g. the Codex review is unavailable, so triage has nothing to do), don't delete its item and don't leave it pending — append a short reason to the item ("skipped — review unavailable") and mark it completed, so the list ends resolved and the skip stays visible. Reserve this for steps with genuinely nothing to do; a blocked step is pending, not skipped.

## Step 1: Resolve the target and scope

Parse the user's input into two things:

**The plan document** — the file to implement from:
* If the user gave a path to a `.md` file, that's the plan document.
* If the user gave a directory, look inside it for `plan.md` (the /create-plan default). If the directory has a differently named plan file, use that; if it's ambiguous, ask.
* Read the plan document in full. Also skim any sibling docs in the plan directory (e.g. `brainstorm.md`, a `design.md`) — they carry context and decisions the plan may reference rather than restate.
* Note the **plan directory** — Step 2 derives the feature-branch name from it, so resolving the target first is what lets the branch be named before any code is written.

**The scope** — how much of the plan to implement this round:
* If the user named a subset (e.g. `plans/foo/plan.md phase 1`, or "just the first phase"), implement only that. Plans from /create-plan split work into `### Implementation Phase <N>` sections, so "phase 1" maps to `Implementation Phase 1`. Keeping rounds small keeps the resulting PR reviewable.
* Otherwise, implement the whole plan.

Confirm your understanding of the scope back to the user in one line before moving on, so a misread is caught cheaply.

## Step 2: Prepare the feature branch

Isolate the implementation on its own feature branch so the diff maps cleanly back to the plan and never lands directly on the trunk. Sort out the branch — and any pending changes — *before* implementing. The Codex review in Step 4 works from the working-tree diff, so the goal throughout is a clean baseline: that diff should be *your* implementation, not a mix of your work and whatever was already in flight.

First gather the git state and identify the trunk:

```bash
git rev-parse --abbrev-ref HEAD                    # current branch
git status --porcelain                             # dirty if non-empty
git symbolic-ref --short refs/remotes/origin/HEAD  # trunk, e.g. origin/main -> main
```

The **trunk** is what `origin/HEAD` resolves to (strip the `origin/` prefix). If there's no remote/`origin` and that command fails, fall back to whichever of `main` / `master` exists locally.

### Case A — already on a non-trunk branch

You're continuing existing feature work (e.g. this is phase 2 of a plan whose phase 1 already created the branch). **Don't create a new branch — stay on it.** Tell the user which branch you're working on.

If the tree is dirty here, the "carry onto a new branch" framing doesn't apply. Ask via AskUserQuestion whether to:
- **Checkpoint-commit on this branch** — commit the pending state so the review diff starts clean (`git commit -am "checkpoint before implementing <plan>"`), or
- **Abort** — stop so the user can sort the changes out and re-run.

### Case B — on the trunk (main/master)

Create a feature branch. Derive its name as `<username>/<slug>`:
- `<username>` — the local-part of `git config user.email` (e.g. `mhzizzi@gmail.com` → `mhzizzi`).
- `<slug>` — the plan directory's basename with any leading `yyyymmdd-` date prefix stripped (e.g. `20260713-oauth-token-refresh` → `oauth-token-refresh`).
- **Collision:** if that branch name already exists, append `-2`, then `-3`, … until you find a free name. Don't prompt — just take the first free variant (the announce step below tells the user which name won).

Then branch, handling the working tree:

**Clean tree** — bring the trunk up to date first, then branch off it:

```bash
git fetch <remote>
git switch <trunk>
git merge --ff-only <remote>/<trunk>   # fast-forward only; refuses if diverged
git switch -c <branch-name>            # branch off the updated trunk
```

If the fast-forward can't be done cleanly — the fetch fails (offline), the trunk has diverged from the remote (local-only commits, so `--ff-only` refuses), or it would otherwise discard local work — **stop and ask** the user how to proceed via AskUserQuestion (e.g. *branch off the local trunk as-is and accept a possibly-stale base*, or *abort and let me reconcile the trunk first*). Don't silently branch off a stale or diverged base. (If there's simply no remote configured, there's nothing to sync against — note that and branch off the local trunk without asking.)

**Dirty tree** — ask via AskUserQuestion which the user wants; offer exactly these two:
- **Carry onto the branch + checkpoint-commit** — the changes are the start of this feature. Create the branch off the *current local* trunk (which carries the uncommitted changes onto it) and commit them as a checkpoint, keeping the trunk clean and giving the Step 4 review a clean baseline. **Skip the remote fast-forward on this path** — reconciling a dirty tree against a freshly-updated trunk invites conflicts — and tell the user the base may be slightly behind remote.
  ```bash
  git switch -c <branch-name>          # carries the uncommitted changes onto the new branch
  git commit -am "checkpoint: pre-existing changes before implementing <plan>"
  ```
- **Abort** — the changes don't belong with this feature. Stop and let the user commit/stash/move them, then re-run.

### Announce the branch

Whichever path you took, emit a one-line message naming the branch you're now on — created, reused, or a `-N` collision variant — and flag it if the base wasn't remote-synced (dirty-carry path, or the user chose to branch off a stale trunk). You'll surface this same branch name again in the Step 9 summary.

## Step 3: Implement

Work through the in-scope portion of the plan. Build a checklist from the plan's implementation steps and execute them in the order the plan lays out — plans are ordered so that later files can import earlier ones.

While implementing:
* Follow the plan's design and code sketches, but treat them as intent, not gospel. Plans are written before the code exists; if reality diverges (an API signature is different, a sketch won't compile, a better approach is obvious), do the right thing and note the deviation for the summary in Step 9. Don't blindly transcribe a sketch that doesn't fit.
* Match the surrounding codebase's conventions, not the plan's illustrative style — the plan's code sketches optimize for explaining structure, not for fitting the repo.
* Verify as you go. Run the relevant build, typecheck, or tests after meaningful chunks rather than saving all verification for the end — a failure caught early is cheaper to locate. If the plan named tests to write or update, write them.

Leave the changes uncommitted (on top of the feature branch and any checkpoint commit from Step 2). The Codex review in the next step reads the working-tree diff.

## Step 4: Codex adversarial review of the implementation

Run a cross-model review of the code you just wrote, using the Codex adversarial review skill:

    Skill(skill: "codex-adversarial-review", args: "--scope auto focus on correctness, edge cases, error handling, and whether the implementation faithfully follows the plan at <plan document path>")

Where `<plan document path>` is the file from Step 1. `--scope auto` picks up the working-tree diff — your implementation. The focus text steers Codex toward code-quality and plan-fidelity concerns.

On success, the output is a plain-text review report — read it as prose, not JSON:
- A `Verdict:` line with the overall assessment, followed by a brief narrative summary.
- A `Findings:` list — each entry starts with `- [severity] title (file:line-range)`, followed by the finding's body and, if present, a `Recommendation:` line.
- A `Next steps:` list of suggested follow-up actions.

Hold the full response for triage in Step 5.

**If the review is unavailable** (plugin not installed, authentication error, CLI unavailable, or another runtime failure), the skill returns a failure reason instead of the report. Note the failure, tell the user the Codex review was unavailable (including the reason), and skip to Step 8 — there are no findings to triage.

## Step 5: Triage the findings

Not every finding is worth acting on, and not every valid finding belongs in this round. For each finding, make three judgments:

1. **Valid or noise?** Is this a real problem, or an overzealous flag — a stylistic nit, a concern the plan already addresses elsewhere, or something that misreads the code? Discard noise. Say briefly why you're discarding anything non-obvious, so the user can object.
2. **Fix now or defer?** Valid findings still need to fit a reasonable PR size. Fix-now means it belongs with this implementation (a correctness bug, a missing edge case central to what you just built). Defer means it's real but out of scope for keeping this round tight.
3. **Trivial or needs thought?** Trivial means the fix is small, local, and obviously correct. Needs-thought means it requires design decisions, touches many call sites, or has non-obvious tradeoffs.

Only findings that are **valid AND fix-now AND trivial** get auto-applied in Step 6. Everything else that's valid gets recorded in Step 7.

If the fix-now/defer call is genuinely a judgment about scope the user should own (e.g. a valid, non-trivial finding that arguably belongs in this round), surface it with AskUserQuestion rather than deciding unilaterally.

## Step 6: Apply the trivial fixes

Implement each finding that came out of Step 5 as valid + fix-now + trivial. Re-run the relevant verification after applying them so a "trivial" fix that turned out to break something is caught before you hand off.

## Step 7: Record deferred findings in the plan's Follow-ups section

Fold every remaining valid finding (deferred, or valid-but-needs-thought) into the `## Follow-ups` section at the end of the plan document. This keeps the record next to the plan a reviewer is already reading, rather than scattered in chat that scrolls away.

Plans from /create-plan seed a `## Follow-ups` placeholder (with a `_None yet._` line) at the end of the document. Replace that placeholder line the first time you add a real finding, and append to the section on later rounds. If the plan has no such section (e.g. it predates the template), create one at the end. For each finding, capture enough for a reviewer to pick it up cold:

```markdown
## Follow-ups

Findings from the implementation review that were not fixed in this round.

### <short title>
- **What:** the issue, in a sentence or two.
- **Where:** file:line (or the area affected).
- **Why deferred:** out of scope for this round / needs design decision / etc.
- **Suggested fix:** the direction Codex proposed, if it holds up.
```

## Step 8: Review the comments you added

Before summarizing, clean up the comments the implementation introduced. The code you just wrote — plus the trivial fixes from Step 6 — tends to accumulate narration and decision-trail comments a reviewer doesn't need. Run the comment review over the working-tree diff, in fix mode at low strictness:

    Skill(skill: "review-comments", args: "fix low")

This edits the code locally, removing or rewriting flagged comments. Re-run the relevant verification afterward if any comment cleanup touched code (e.g. a comment was folded into a rename), so a cleanup that broke something is caught before you hand off.

## Step 9: Summarize for the user

Give the user a concise wrap-up — they can read the diff and the plan themselves, so focus on what they need to decide or know:
- The **feature branch** the work landed on (the same name announced in Step 2) — so the summary is self-contained and the branch is easy to find for review/PR. Note it if the base wasn't remote-synced.
- What was implemented (which plan / which scope).
- Any deviations from the plan and why.
- The Codex review outcome: how many findings, how many you fixed inline, how many you deferred. If the review was unavailable, say so and why.
- The verification you ran and its result — state failures plainly with the output; don't imply something passed that you didn't run.
- What's left, if this was a subset of a larger plan.

**Always** include a **Follow-ups added this round** section listing every follow-up you wrote into the plan's `## Follow-ups` section in Step 7 — even if there's only one, and even if you already mentioned the deferred count above. For each, give the short title and a one-line gist so the user sees what's outstanding without opening the plan. If Step 7 added no follow-ups (nothing valid was deferred), say so explicitly ("No follow-ups added this round") rather than omitting the section — its absence should never be ambiguous.
