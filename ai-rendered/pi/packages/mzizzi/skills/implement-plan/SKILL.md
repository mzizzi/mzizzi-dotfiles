---
name: implement-plan
description: Turn a plan.md (or a subset of it) into working code, then run the correctness, quality, and comment passes over the changes. Use whenever a plan document already exists and the user wants it built, executed, or implemented — including "build phase 1 of this plan" or pointing at a plan directory and saying "go".
disable-model-invocation: false
---

Resolve `<skill-dir>` to this skill's absolute directory. This workflow needs task tools, `pi-subagents`, and the worktree extension; stop if unavailable.

## Step 0: Resolve the target and scope

**The plan document.** A `.md` path if the user gave one; otherwise `plan.md` inside the directory they named, or that directory's differently-named plan file — ask if it's ambiguous. Read it in full, and skim sibling docs (`brainstorm.md`, `design.md`) for decisions the plan references rather than restates. Note the **plan directory**: Step 1 derives the branch name from it.

**The scope.** A named subset (`plans/foo/plan.md phase 1`, "just the first phase") maps to that `### Implementation Phase <N>` section and nothing else — small rounds keep the PR reviewable. Otherwise, the whole plan.

Confirm the scope back to the user in one line before moving on, so a misread is caught cheaply.

## Step 1: Prepare the feature branch

Read and follow the `prepare-feature-branch` skill at `<skill-dir>/../prepare-feature-branch/SKILL.md` with arguments `<plan directory>`. Return here after branch preparation, including completed worktree entry, before Step 2.

Prepare the branch before implementation; Step 4 reviews that checkout's working diff. The skill derives the name, reuses existing feature work for this plan or creates it, commits the plan document onto the branch, and announces the result. An untracked plan directory is expected there and needs no intervention; unrelated pending edits get put to the user as a choice, so relay whatever they decided rather than re-litigating it here.

Keep referencing the plan by its Step 0 absolute path. Entering a worktree changes the cwd; that path still resolves.

## Step 2: Seed the task list

Create exactly one task per in-scope phase, then one for review passes and one for the summary. Use phase titles without hand-written task numbers; descriptions point to the plan.

Use two messages: all `TaskCreate` calls, then all `TaskUpdate` calls that chain each task after its predecessor with `addBlockedBy`. Keep exactly one item in progress. Update completion alongside the next task's first action; leave unrelated tasks alone.

Complete satisfied phases with a short reason. If blocked, record the reason and leave unfinished work pending. Do not finish with pending tasks unless the workflow genuinely stops.

## Step 3: Implement

Take the Step 2 items in chain order — plans order files so that later ones can import earlier ones.

- Use the `mzizzi.standard` agent: delegate at least one child per phase. Enable `subagent` if needed: `subagent({agent:"mzizzi.standard", task:"<phase, absolute plan path, scope, checks>", cwd:"<selected absolute cwd>", async:true, options:{context:"fresh"}})`.
- Wait for native completion before dependent work. Keep all phases in this checkout; do not allocate child worktrees.
- Ask children to hand off before context exhaustion. On child failure, report the blocker rather than silently replacing delegation with parent work.
- Treat the plan's design and code sketches as intent, not rigid. If a better approach is obvious or the plan was incorrect then do the right thing and note the deviation for Step 5.
- Match the surrounding codebase's conventions, not the plan's illustrative style.
- Verify as you go, after meaningful chunks rather than all at the end; a failure caught early is cheaper to locate. Write any tests the plan named.

Leave the changes uncommitted on the Step 1 branch. All three passes ahead read the working-tree diff.

## Step 4: Review passes

Read and follow the `fix-all` skill at `<skill-dir>/../fix-all/SKILL.md` with arguments `--plan <plan document path> --strictness=high --apply=all`. Use the same checkout and uncommitted diff. Return here afterward.

`<plan document path>` is the file from Step 0. No `--base`: the implementation is still uncommitted. `--strictness=high` covers the long block comments and module headers fresh implementation work tends to produce. `--apply=all` fixes the large findings now rather than deferring them: the code is fresh and uncommitted, so an invasive edit is cheapest here.

That skill runs the correctness, quality, and comment passes in order over the working-tree diff, steers the first two toward plan fidelity, applies every valid fix, writes anything still deferred into the plan's `## Follow-ups`, and verifies afterwards. Read its per-pass report and carry each outcome into Step 5 separately.

If it reports a review was unavailable, a verification failure, or an applied cleanup you disagree with, deal with that here rather than passing it on.

## Step 5: Summarize for the user

The user can read the diff and the plan themselves, so cover what they need to decide or know:

- The **feature branch**, and the **worktree path** when applicable (both announced in Step 1), so the summary is self-contained. Do not automatically exit. The worktree stays after shutdown; include the replacement session path if entry occurred.
- What was implemented, from which plan and scope.
- Deviations from the plan, and why.
- Each pass's outcome, reported separately since they answer different questions: findings raised, fixed inline, and deferred for the correctness and quality passes; what it cut for the comment pass. If any was unavailable, say so and why.
- The verification you ran and its result. State failures plainly with the output; never imply something passed that you didn't run.
- What's left, if this was a subset of a larger plan.

**Always** include a **Follow-ups added this round** section: every follow-up the passes recorded into the plan, with its short title and a one-line gist, even if there's only one. If you recorded none, say "No follow-ups added this round" — its absence should never be ambiguous.
