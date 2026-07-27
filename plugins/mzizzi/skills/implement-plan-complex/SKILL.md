---
name: implement-plan-complex
description: Run a multi-phase plan end to end by orchestrating one /implement-plan sub-agent per phase, chained with blocked-by task dependencies and a commit between each. Use this whenever the user wants several phases of a plan implemented in one go: "implement phases 1-3 of plans/…", "run the whole plan phase by phase", "implement the plan, one sub-agent per phase", or any request pairing a plan with a phase range. Prefer it over calling /implement-plan directly whenever more than one phase is in scope, because implementing phases inline piles every phase's context into one window and the later phases degrade.
argument-hint: <plan directory or plan.md> [phase range, e.g. "phases 1-3"] [--worktree]
allowed-tools: Read, Grep, Glob, Bash, Agent, AskUserQuestion, Skill, EnterWorktree, TaskCreate, TaskUpdate, TaskList
disable-model-invocation: false
user-invocable: true
---

# Implement Plan (multi-phase)

Spawn one sub-agent per phase, each running `implement-plan` for exactly that phase. You own the branch, the task chain, the commits, and whatever state has to travel between phases. Don't write the code yourself, and don't invoke `implement-plan` in your own context. No phase should inherit the previous phase's context, and that includes yours.

## 1. Resolve

The plan document, the phase range, and `--worktree`. The plan document is a `.md` path, or `plan.md` inside a directory the user names. Ask if that directory holds several. The range looks like "phases 1-3". With none given, take every phase. Plans from `/create-plan` use `### Implementation Phase <N>` headings.

Read the plan and its sibling docs (`brainstorm.md`, `design.md`) in full. You'll be quoting them into the task descriptions in step 3, and this is the last deep read you get. Then confirm plan, range, and phase count in one line.

## 2. Branch

    Skill(skill: "prepare-feature-branch", args: "<plan directory> [--worktree]")

Run it once, before any sub-agent starts. Each sub-agent's `implement-plan` calls the same skill, derives the same name, and reuses this branch instead of forking its own. Sub-agents inherit the session cwd, so one worktree entry covers the run.

A dirty tree aborts it. A plan fresh from `/create-plan` is itself uncommitted, so commit the plan before starting. `implement-plan` has the same precondition.

## 3. Create the tasks, then chain them

Create one task per phase with `TaskCreate`, writing the sub-agent's prompt into the task's `description`. That field holds the prompt you'll spawn with in step 4. It isn't a label for a prompt you compose later. Write all of them now, while the whole plan is still in view, then chain them with `TaskUpdate` (`TaskCreate` has no blocked-by field):

```
TaskCreate {subject: "Phase 1 — <phase title>", description: "<the sub-agent's prompt>"}
TaskUpdate {taskId: "2", addBlockedBy: ["1"]}
```

Everything the prompt can take from the plan goes in the `description` now:

- invoke `mzizzi:implement-plan` via the Skill tool for **only** `### Implementation Phase <N>` of `<absolute plan path>`
- phase N only, naming the files that belong to later phases. The sub-agent reads the whole plan, so the boundary has to be concrete
- the deliverables, in the plan's own words
- which `## Design` sections carry the rationale. A phase section alone gives the shape without the reasons
- for measurement or browser-check phases: what to automate, and what to report rather than fake

Write them now and they come from one careful read of the plan. Leave them until spawn time and each one gets composed from a context already crowded with earlier phases, so the later prompts get vaguer exactly as the work gets more dependent on precision. Doing it up front also makes the whole chain reviewable, in the task list, before any code exists.

## 4. Run the chain

For each phase in order. Never two at once, and never skip ahead.

1. **Mark it in progress** with `TaskUpdate`.
2. **Spawn one sub-agent** (`mzizzi:standard`, `run_in_background: false`), passing the task's `description` as its prompt. Add the two things only now knowable: which phases already landed and which committed files to read before writing anything that has to agree with them, plus any correction an earlier phase forced on the plan, with which to trust ("the plan text is updated to match; trust the code").
3. **Verify, then commit everything.** `implement-plan` leaves its changes uncommitted for its Codex review, so committing is your job. Check `git status` and the diff against what the sub-agent claimed. Re-run verification yourself if its report was vague. Fold any deviation the phase forced back into the plan document _before_ you commit, then commit the lot, code and plan edits together, naming the phase. Anything you leave uncommitted stalls the next phase, since `implement-plan` aborts on a dirty tree.
4. **Mark it completed**, then propagate that deviation into the downstream tasks' descriptions with `TaskUpdate`, so it reaches the sub-agents that need it. You see every phase. No sub-agent does.
5. **Tell the user** before starting the next phase: what landed, the commit, the Codex outcome the sub-agent reported, whether verification passed, and which phase is next. Keep it to a few lines. A multi-phase run is otherwise silent for a long stretch, and the phase boundary is where stopping or redirecting stays cheap. That only helps if the user knows what just happened while the choice is still open.

A phase that can't finish leaves the rest pending. Pending is the honest state for work that didn't happen. Say so at the boundary too. Don't press on to the next phase, and don't go quiet until the end.

## 5. Summarize

Cover the branch and worktree path, the phases that landed with their commits, the deviations and the corrections you propagated, and which Codex findings were fixed inline versus deferred into the plan's `## Follow-ups`. State the verification you ran, with failures quoted plainly. Say what's left for a human, and what's left over if the range was a subset. If a phase stopped short, name it and describe the state of the branch. A half-finished chain reported as finished is worse than one reported as blocked.
