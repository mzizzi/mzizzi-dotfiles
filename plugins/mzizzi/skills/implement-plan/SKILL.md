---
name: implement-plan
description: Implement a technical plan produced by /create-plan — turn a plan.md (or a subset of it) into working code, then run correctness, quality, and comment passes over the changes, each triaging what it finds. Use this skill whenever the user wants to build out, execute, or implement an existing plan, or says things like "implement the plan in plans/…", "let's build phase 1 of this plan", "execute plan.md", or points at a plan directory and says "go". Prefer this over ad-hoc implementation whenever a plan document already exists — it keeps the diff reviewable and folds deferred review findings back into the plan.
argument-hint: <plan directory or plan.md> [subset to implement, e.g. "phase 1"] [--worktree]
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, Agent, AskUserQuestion, Skill, EnterWorktree, TaskCreate, TaskUpdate, TaskList
disable-model-invocation: false
user-invocable: true
---

## Step 0: Resolve the target and scope

**The plan document.** A `.md` path if the user gave one; otherwise `plan.md` inside the directory they named, or that directory's differently-named plan file — ask if it's ambiguous. Read it in full, and skim sibling docs (`brainstorm.md`, `design.md`) for decisions the plan references rather than restates. Note the **plan directory**: Step 1 derives the branch name from it.

**The scope.** A named subset (`plans/foo/plan.md phase 1`, "just the first phase") maps to that `### Implementation Phase <N>` section and nothing else — small rounds keep the PR reviewable. Otherwise, the whole plan.

**`--worktree`.** An optional token anywhere in the arguments: brand-new feature work gets an isolated git worktree instead of a plain branch. No effect when the plan already has feature work to reuse.

Confirm the scope back to the user in one line before moving on, so a misread is caught cheaply.

## Step 1: Prepare the feature branch

    Skill(skill: "prepare-feature-branch", args: "<plan directory> [--worktree]")

The branch keeps the diff mapped to the plan and off the trunk, and Steps 4–6 all read the working-tree diff, so the baseline must be clean. The skill derives the name, reuses existing feature work for this plan or creates it off the trunk, and announces the result. It aborts on a dirty tree — relay that and stop, rather than stashing on the user's behalf.

Keep referencing the plan by its Step 0 absolute path. Entering a worktree changes the cwd; that path still resolves.

## Step 2: Seed the task list

Every item is knowable now, so build the list in **two messages**: one carrying every `TaskCreate`, one carrying every `TaskUpdate` that chains them. Two only because `TaskCreate` has no blocked-by field.

**Implementation items: exactly one per in-scope `### Implementation Phase <N>` section**, in plan order. One task per phase and no finer — not one per file the phase lists, not one per bullet inside it. A phase touching six files is one task. The count is checkable before you send it: implementation items should equal in-scope phases, and if it doesn't, you've split a phase that the plan already treats as one unit of work.

The plan is the description of the work; the task list is a progress marker over it. Splitting per file duplicates the plan into the list, buries the phase boundaries the run is actually paced by, and puts a wall of items in front of the user that the plan already says better.

**Don't hand-write numbers into subjects.** The harness assigns each task an id, and that id is this run's task number. The plan's phase numbers are a different scheme that won't line up with it, since the tail items belong to no phase at all. Name the phase as text — its own title from the plan — and let the id do the numbering:

    implement Phase 1 — the shared, glob-free core
    implement Phase 2 — the batch CLI, and the deletions
    implement Phase 3 — the dev-server plugin

**Tail items:** correctness pass, quality pass, comment fixes, summarize. Seeding them before any code exists is what protects the tail — finishing the implementation doesn't end the run.

**Descriptions are pointers, not copies.** A file:line reference (`plan.md:517`) or half a line of gist. The plan holds the instructions and stays correct; restating it spends context saying the same thing twice.

**Chain them.** Each task blocked by the one before it: implementation items in plan order, then the tail in step order, with the correctness pass blocked by the last implementation item. All in one message:

```
TaskUpdate {taskId: "2", addBlockedBy: ["1"]}
TaskUpdate {taskId: "3", addBlockedBy: ["2"]}
```

The chain puts the run's order in the list while changing it is still free.

**Status discipline:**

- Bookkeeping never gets its own turn. A completion rides in the same message as the next item's first tool call, alongside that item's in-progress mark. An update travels alone only when the run is ending.
- Exactly one of _this run's_ items in progress at a time; complete each as it's done, never in a batch at the end. Unrelated tasks already in the session get left alone.
- Never end the turn with this run's items pending unless the run genuinely stopped short — redirected, aborted, or blocked (failing verification, an unavailable dependency, an unresolvable tool error). Annotate the current item with the blocker and leave it and everything downstream pending; pending is the honest state for unfinished work.
- A step that becomes moot (the correctness pass reports the review was unavailable, so there is nothing to act on) gets a short reason appended and is marked completed — not deleted, not left pending. Blocked is pending; moot is completed.

## Step 3: Implement

Take the Step 2 items in chain order — plans order files so that later ones can import earlier ones.

- Treat the plan's design and code sketches as intent, not gospel. If reality diverges — an API signature differs, a sketch won't compile, a better approach is obvious — do the right thing and note the deviation for Step 7.
- Match the surrounding codebase's conventions, not the plan's illustrative style.
- Verify as you go, after meaningful chunks rather than all at the end; a failure caught early is cheaper to locate. Write any tests the plan named.

Leave the changes uncommitted on the Step 1 branch. All three passes ahead read the working-tree diff.

## Step 4: Correctness pass

    Skill(skill: "fix-correctness", args: "--plan <plan document path>")

`<plan document path>` is the file from Step 0. That skill runs the Codex adversarial review over the working-tree diff — steered toward plan fidelity by the `--plan` argument — triages what it finds, applies the trivial in-scope fixes, verifies, and writes the rest into the plan's `## Follow-ups`. Read its report and carry the outcome into Step 7.

If it reports the review was unavailable, or a verification failure, deal with that here rather than passing it on.

## Step 5: Quality pass

    Skill(skill: "fix-quality", args: "local --plan <plan document path>")

`local` is the right target — the implementation is still uncommitted. That skill does the whole pass: it reviews from four quality angles, applies the contained cleanups, and writes what it deferred into the plan's `## Follow-ups` section itself. Read its report and carry the outcome into Step 7.

If it reports a verification failure, or an applied cleanup you disagree with, fix that here rather than passing it on.

## Step 6: Fix the comments you added

    Skill(skill: "fix-comments", args: "--strictness=low")

The implementation plus the fixes from Steps 4 and 5 tends to leave narration and decision-trail comments a reviewer doesn't need. This edits the code locally; re-run the relevant verification if the cleanup touched code, e.g. a comment folded into a rename.

## Step 7: Summarize for the user

The user can read the diff and the plan themselves, so cover what they need to decide or know:

- The **feature branch**, and the **worktree path** when applicable (both announced in Step 1), so the summary is self-contained. A worktree persists after the session — the harness offers to keep or remove it on exit; keep it for review/PR.
- What was implemented, from which plan and scope.
- Deviations from the plan, and why.
- Each pass's outcome, reported separately since they answer different questions: findings raised, fixed inline, and deferred for the correctness and quality passes; what it cut for the comment pass. If any was unavailable, say so and why.
- The verification you ran and its result. State failures plainly with the output; never imply something passed that you didn't run.
- What's left, if this was a subset of a larger plan.

**Always** include a **Follow-ups added this round** section: every follow-up the passes recorded into the plan, with its short title and a one-line gist, even if there's only one. If you recorded none, say "No follow-ups added this round" — its absence should never be ambiguous.
