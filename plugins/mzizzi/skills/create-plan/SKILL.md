---
name: create-plan
description: Create a technical plan document in plans/. Use this skill whenever the user wants to plan a new feature, design a system, write an implementation plan, or think through an approach before coding. Also use when the user says things like "let's plan", "how should we implement", "write up a plan for", or "I want to think through X before building it". Also use to turn an existing brainstorm or notes in a plan directory into a full plan — when the user cites a plan dir or a file like brainstorm.md, reuse that directory instead of creating a new one.
argument-hint: <plan directory or target .md file> <topic or feature description> [--model opus|sonnet|haiku]
allowed-tools: Read, Grep, Glob, Agent, AskUserQuestion, Write, Skill
disable-model-invocation: false  # explicitly model-invokable (the default; stated so it can't silently drift)
user-invocable: true             # explicitly available as a /create-plan slash command
---

# Create Plan

Generate a technical plan document (`plan.md` by default, or a filename the user names) or update an existing one by extensively researching the codebase and interviewing the user.


## Instructions

### Step 1: Understand the request

Parse the user's input to extract:
* If the user provided one, read every document in the plan directory
* **What:** they want to build or change
* **Why:**: the motivation or problem being solved (if stated)
* **Where:** it fits in the codebase (if obvious from context)
* **Planning model:** which model the Step 4 planning sub-agent should run on. If the user named one (e.g. `--model sonnet`, or "plan this on haiku"), use it; otherwise default to `opus`. Accept the aliases `opus`, `sonnet`, and `haiku`.

### Step 2: Resolve the plan directory and target file

The plan is written to `<plan directory>/<target file>`. Resolve both from the user's input.

**Target file** — the filename to write, defaulting to `plan.md`:
* If the user named a target file (any argument ending in `.md`, e.g. `design.md`, or a full path like `plans/20260615-token-refresh/design.md`), use that filename.
* Otherwise use `plan.md`.

**Plan directory:**
* If the user gave a full path to the target file (it includes a directory component), that parent directory is the plan directory — continue to step 3.
* Otherwise, if the user provided a plan directory, use it — continue to step 3.
* Otherwise, use the /create-plan-dir skill to create one.

Refer to the resolved destination as `<target file path>` in the steps below (e.g. `plans/20260615-token-refresh/plan.md`, or `plans/20260615-token-refresh/design.md` if the user named `design.md`).

### Step 3: Grill the user

* Use the /grill skill to gather additional context and requirements for the desired change
* If the target file already exists, or there is a brainstorm.md in the plan directory, use that as a starting point instead of re-asking

### Step 4: Create a draft plan

* Spawn a **Plan-mode sub-agent** (`subagent_type: "Plan"`), passing `model` set to the planning model resolved in Step 1 (default `opus`). Pinning `model` matters because a Plan sub-agent otherwise inherits the session model — so the plan would silently run on whatever the main session happens to be on. Planning leans on deep reasoning, which is why it defaults to Opus; `sonnet` or `haiku` are there for a faster, cheaper draft on simpler work. The sub-agent should be prompted with the following:
  * The output format template from the "Plan Output Template" section at the bottom of this document
  * Be sure the sub-agent is briefed with the context gathered, any existing target-file or brainstorm.md documents, and any other information that would help the sub-agent
  * The sub-agent should split implementation into logical chunks where it makes sense to do so
  * Code sketches should show structure and signatures, with comments explaining non-obvious logic. The sub-agent is constructing a plan document, not a copy-paste implementation.
* Update or create the target file at `<target file path>` (from step 2) with the sub-agent's output

### Step 5: Codex adversarial review

Invoke the Codex adversarial review skill to get a cross-model challenge of the draft plan from Codex (using whichever GPT model the user has configured):

    Skill(skill: "codex-adversarial-review", args: "--wait --scope auto focus on feasibility, completeness, missing risks, and questionable assumptions in the plan at <target file path>")

Where `<target file path>` is the path written in Step 4 (e.g., `plans/20260615-token-refresh/plan.md`). The focus text steers Codex toward plan-quality concerns rather than code-quality concerns.

On success, the output is a plain-text review report — not JSON, read it as prose:
- A `Verdict:` line with the overall assessment, followed by a brief narrative summary.
- A `Findings:` list — each entry starts with `- [severity] title (file:line-range)`, followed by the finding's full body text and, if present, a `Recommendation:` line.
- A `Next steps:` list of suggested follow-up actions.

Hold the full response for the incorporation step.

**If the review is unavailable** (plugin not installed, authentication error, CLI unavailable, or another runtime failure), the skill returns a failure reason instead of the report above. Note the failure, tell the user the Codex review was unavailable (including the reason), and continue directly to Step 7 (open questions loop), skipping Step 6.

### Step 6: Incorporate Codex feedback

Process the Codex adversarial review findings and strengthen the draft plan. This step runs in the main conversation — no sub-agents.

**For each finding, by severity:**

- **Critical or high severity:** The plan has a significant gap or questionable assumption. Directly revise the relevant section (Design, Implementation, or Testing) to address the concern. Don't just acknowledge it — strengthen the plan text so the concern is resolved. If the finding identifies something genuinely missing (error handling strategy, performance risk, dependency issue), add it.
- **Medium severity:** Often surfaces unconsidered tradeoffs or dismissed alternatives. If the fix is clear, apply it. If it requires a user decision, add it to `## Open Questions` with a `[Codex]` prefix.
- **Low severity:** Apply trivially fixable suggestions (clarity, organization). Discard the rest unless they add genuine value.

**For `next_steps` from Codex:** Scan for actionable items. Those that map to user decisions become `[Codex]` open questions. Those that are purely technical and clearly correct get applied directly.

**Provenance:** When adding or revising content based on Codex findings, tag new open questions with `[Codex]` so the user knows their origin during the interview loop. Individual edits to plan sections don't need tagging.

After incorporating all findings, update the draft plan in memory (do not write to disk yet — that happens in Step 8 after the interview loop).

### Step 7: Resolve open questions (loop)

Resolve all open questions through a user interview loop. The goal is to produce a plan that needs minimal modification after the write. This loop runs in the main conversation — no sub-agents. The Step 4 sub-agent already did the deep codebase research; this step is about resolving decisions and their implications.

**For each iteration:**

1. Parse the `## Open Questions` section from the current plan draft.
2. If there are no open questions, exit the loop and proceed to Step 8.
3. For questions that are purely technical and the research clearly points to one answer, auto-resolve them — update the plan draft and note to the user what you resolved and why, so they can object if needed.
4. Present remaining open questions to the user using AskUserQuestion. For each question:
   - State the question clearly
   - Offer a few concrete choices (typically 2–4)
   - Recommend one choice and briefly explain why — draw on what you learned during research
5. After the user answers, incorporate their decisions into the plan draft. Reason about whether the chosen direction introduces new open questions. If a specific answer requires verifying something in the codebase, do a targeted lookup (Grep/Read) rather than a full research pass.
6. Update the `## Open Questions` section — remove resolved questions, add any new ones — and loop back to (1).

**Guidelines:**
- Batch related questions into a single AskUserQuestion call rather than asking one at a time.
- Don't loop more than 3 iterations — if questions keep spawning, collect the remaining ones into an "Open Questions" section and move on.

### Step 8: Write the final plan document

Overwrite the draft plan (written in Step 4) with the final version. If the interview loop resolved all questions, remove the `## Open Questions` section entirely. If the loop hit the iteration cap with questions remaining, keep them in `## Open Questions` — these are genuinely unresolved and may block implementation.

### Step 9: Consistency check

Re-read the final plan end-to-end and verify there are no internal contradictions or stale text. Specifically check:

- Statements from the original draft that were invalidated by Codex feedback or user decisions but not updated (e.g., "in-memory only" surviving after a decision to persist to DB).
- Code sketches that use APIs, types, or function signatures inconsistent with the Design section (e.g., `time.monotonic()` in code when the design says `time.time()`).
- Throughput estimates or performance claims that don't match the final parameters

Fix any issues found. This step exists because plans undergo multiple rounds of revision (draft → Codex incorporation → user decisions) and each round can leave stale text behind.

### Step 10: Present to the user

After writing the plan, give the user a brief summary of:
- Where the plan was saved
- The key design decisions made
- Whether the Codex adversarial review ran and what it surfaced (briefly — e.g., "Codex flagged 2 risks that were incorporated into the Design section")
- Any deferred questions that remain

Don't recite the whole plan back — they can read the file. Focus on decisions they should weigh in on.

## Plan Output Template

```markdown
# Title

## Context
Why this work is needed — the problem, what triggered it, relevant background.
This section helps future readers understand the motivation without the original conversation.

## Design
The core technical approach. Include:
* Data models with field-level detail (dataclasses, Pydantic models, SQL schemas)
* Algorithms or workflows described step by step
* Key decisions with rationale and any alternatives that were considered
    
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

## Resolved Questions
* ...
```