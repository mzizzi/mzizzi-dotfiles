---
name: create-plan
description: "Write a technical plan document in plans/. Use when the user wants to plan a feature, design a system, or think an approach through before coding. If they cite an existing plan dir or brainstorm.md, reuse that directory instead of creating a new one."
argument-hint: <plan directory or target .md file> <topic or feature description> [--non-interactive]
allowed-tools: Read, Grep, Glob, Agent, AskUserQuestion, Write, Edit, Skill
disable-model-invocation: false
user-invocable: true
---

# Create Plan

Generate a technical plan document (`plan.md` by default, or a filename the user names) or update an existing one by extensively researching the codebase and interviewing the user.

IMPORTANT: Write only to the plan directory. Research is read-only: never edit code, config, or other docs, and never run a command that changes state outside the plan directory.

`--non-interactive` means no user is present: never call AskUserQuestion, and Step 5 hands decisions to an agent instead.

## Instructions

### Step 1: Understand the request and resolve `<target file path>`

Read the files the user cites, and, in a plan directory they gave, its `brainstorm.md` and target file if they exist.

Then resolve where the plan goes. Use the plan directory the user gave (or the parent of a `.md` path they gave); otherwise create one with the /create-plan-dir skill, named for the topic as you now understand it. The target file is the `.md` filename they named, else `plan.md`.

### Step 2: Draft the plan

Research and write the draft yourself.

- Load the `development-preferences` skill and hold the design to it.
- Hand broad searches to a `mzizzi:simple` agent that returns conclusions, not file contents.
- Write the draft to `<target file path>` using the "Plan Output Template" below.
- Code sketches show structure and signatures, not a copy-paste implementation.
- List each decision the research could not settle under `## Open Questions`, with your recommendation.

### Step 3: Adversarial reviews

Codex looks for what's missing, the pragmatic reviewer for what's excess. Start the pragmatic reviewer in the background, then run Codex:

    Agent(subagent_type: "mzizzi:pragmatic-reviewer", prompt: "Review the plan at <target file path>. Also answer each item under its ## Open Questions: the option you would pick and why.")
    Skill(skill: "codex-adversarial-review", args: "--model gpt-6-astra --effort high --files <target file path> focus on feasibility, completeness, missing risks, and questionable assumptions. Right-size each recommendation to the problem — KISS/YAGNI/DRY balanced against the complexity the plan actually warrants; no scope or machinery the plan's stated problem does not require. Answer each item under Open Questions with the option you would pick and why.")

Hold both reports for Step 4. If a review is unavailable, tell the user which one and why, and continue with the other; if both are, skip to Step 5.

### Step 4: Incorporate review feedback

Incorporate the feedback from the reviews into the plan document using your best judgment.

- **The plan is missing something or rests on a wrong assumption:** change the plan to fix it.
- **The plan includes something it doesn't need:** remove it.
- **The finding is wrong or not worth acting on:** skip it.
- **Only the user can decide it** (scope, product direction): add it to `## Open Questions`, tagged `[Codex]` or `[Pragmatism]`.
- **The reviews disagree** (one wants something strengthened, the other wants it removed): add it to `## Open Questions` with both positions.

Weigh the reviewers' answers and settle the open questions you can.

### Step 5: Resolve open questions

Loop until `## Open Questions` is empty, at most 3 rounds:

1. Settle the questions the research clearly answers, and tell the user what you decided and why.
2. Put the rest to the decider in one batch, each question with 2–4 concrete options and your recommendation:
   - By default, ask the user with AskUserQuestion.
   - With `--non-interactive`, send them to one `mzizzi:complex` agent along with `<target file path>`. Its answers are the decisions.
3. Write each decision into the plan where its question arose. Add any new questions a decision raises; check facts with a targeted lookup, not a new research pass.

Delete the section once it is empty. Questions still open after 3 rounds stay in the plan: they are genuinely unresolved and may block implementation.

### Step 6: Consistency check

Each round of revision can leave stale text behind. Re-read the plan end to end and fix contradictions: statements a review or decision invalidated, code sketches that disagree with the Design section, and estimates that no longer match the final parameters.

### Step 7: Present to the user

Report, in this order, without reciting the plan:

- Where the plan was saved.
- One bullet per implementation phase, 1–2 sentences each, in plan order. The user's next decision is which phases to implement.
- One line on what the reviews surfaced, plus any questions left open.

End with this command alone on the last line, using the absolute path, with no backticks or punctuation, so it can be copied:

    /mzizzi:implement-plan <target file path>

## Plan Output Template

<!-- prettier-ignore -->
```markdown
# Title

## Context
Why this work is needed — the problem, what triggered it, relevant background.
This section helps future readers understand the motivation without the original conversation.

## Design
The core technical approach. Include:
* Data models with field-level detail (dataclasses, Pydantic models, SQL schemas)
* Algorithms or workflows
* Key decisions and rationale
    
## Implementation

### Implementation Phase <N...>

Specific files to create or modify, in order. For each file:
- What it does
- Key functions/classes with signatures and brief descriptions
- Code sketches with actual function signatures, not pseudocode
- How it integrates with existing code (imports, call sites, state flow)
- How to test the new or changed functionality:
    - Keep this section directional — describe what to test and why, not full test implementations.
    - New test files or test functions to create, with brief descriptions of what they verify
    - Existing tests that need updating or refactoring to accommodate the changes
    - Key scenarios and edge cases worth covering
    
## Open Questions
Topics that need investigation or a user decision before or during implementation.
* ...

## Follow-ups
Deferred issues to revisit — populated later (e.g. during implementation, by the
/implement-plan review pass) rather than at planning time. Leave as a placeholder.
* _None yet._
```
