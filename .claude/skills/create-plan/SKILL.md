---
name: create-plan
description: Create a technical plan document in plans/. Use this skill whenever the user wants to plan a new feature, design a system, write an implementation plan, or think through an approach before coding. Also use when the user says things like "let's plan", "how should we implement", "write up a plan for", or "I want to think through X before building it".
argument-hint: <topic or feature description>
allowed-tools: Read, Grep, Glob, Agent, AskUserQuestion, Write, Skill
---

# Create Plan

Generate a technical plan document in `plans/<topic-directory>/` by researching the codebase and interviewing the user.

## Step 1: Understand the request

Parse the user's input to extract:
- **What** they want to build or change
- **Why** — the motivation or problem being solved (if stated)
- **Where** it fits in the codebase (if obvious from context)

If the request is vague or missing critical details, interview the user before proceeding. Use the AskUserQuestion tool to ask focused questions — don't ask everything at once, prioritize what you actually need to start planning. Common gaps to probe:

- What problem does this solve? What's the trigger for doing it now?
- Which existing subsystem does this touch?
- Are there constraints (performance, compatibility, dependencies on other work)?
- What's the scope — is this a standalone feature or part of a larger initiative?

You don't need to ask about things you can figure out by reading the code. If the codebase already has clear conventions for the area being planned, just follow them.

## Step 2: Research and plan via sub-agent

Spawn a **Plan-mode sub-agent** (`subagent_type: "Plan"`) to do the heavy lifting. Brief it with everything you've gathered from the user, including any interview answers. The sub-agent's job is to produce the final plan markdown — ready to write to disk without reformatting.

Before writing the prompt, determine the target file path:
- **Directory:** Pick an existing topic directory under `plans/` if this work fits naturally into one (e.g., auth work goes in `plans/auth/`). Create a new directory only if the topic is genuinely new.
- **Filename:** Short, descriptive, kebab-case. Look at sibling files in the same directory for naming conventions.

The prompt to the sub-agent should look roughly like:

```
Research the codebase and produce a detailed implementation plan for: <what the user wants>

Context: <why, constraints, scope, any interview answers>

The plan will be saved to: plans/<directory>/<name>.md

## Research steps

1. Read the relevant existing source code, tests, and configuration to understand the current state.
2. Check docs/ for relevant documentation if applicable.
3. Design the implementation — files to create/modify, data models, algorithms, integration points.
4. Identify risks, open questions, and alternatives considered.

## Output format

Return the complete plan as markdown, ready to be written directly to a file.
The plan should be specific enough that someone could implement from it.
Use this structure:

# Title

## Context
Why this work is needed — the problem, what triggered it, relevant background.
This section helps future readers understand the motivation without the original conversation.

## Design
The core technical approach. Include:
- Data models with field-level detail (dataclasses, Pydantic models, SQL schemas)
- Algorithms or workflows described step by step
- Key decisions with rationale and alternatives considered
- Code sketches with actual function signatures, not pseudocode

## Implementation
Specific files to create or modify, in order. For each file:
- What it does
- Key functions/classes with signatures and brief descriptions
- How it integrates with existing code (imports, call sites, state flow)

## Testing
How to test the new or changed functionality. Include:
- New test files or test functions to create, with brief descriptions of what they verify
- Existing tests that need updating or refactoring to accommodate the changes
- Key scenarios and edge cases worth covering

Keep this section directional — describe what to test and why, not full test implementations.

## Open Questions
Anything that needs further investigation or a user decision before or during implementation.

## Documentation rules
- Don't hardcode counts, sizes, or specific threshold values that will change as code evolves.
- Don't duplicate field names/types/defaults from Pydantic models or dataclasses — reference the model by name and file path.
- Code sketches should show structure and signatures, with comments explaining non-obvious logic. The plan is a design document, not a copy-paste implementation.

```

## Step 3: Write draft plan to disk

Write the sub-agent's draft plan to the target file path determined in Step 2. This is not the final version — it will be overwritten after the review and interview steps.

Writing the draft to disk now serves two purposes:
1. It creates a git working tree diff that Codex can review in the next step.
2. It provides a save point — if the session is interrupted, the draft is not lost.

Use the Write tool to create the file. If the target directory does not exist, create it.

## Step 4: Codex adversarial review

Invoke the Codex adversarial review skill to get a cross-model challenge of the draft plan from GPT-5.4:

    Skill(skill: "codex:adversarial-review", args: "--wait --scope auto focus on feasibility, completeness, missing risks, and questionable assumptions in the plan at <target file path>")

Where `<target file path>` is the path written in Step 3 (e.g., `plans/auth/token-refresh.md`). The focus text steers Codex toward plan-quality concerns rather than code-quality concerns. The `--wait` flag ensures results return before the next step.

The output is structured JSON with:
- `verdict` — overall assessment
- `summary` — brief narrative
- `findings` array — each with `severity`, `title`, `body`, `file`, `line_start`, `line_end`, `confidence`, `recommendation`
- `next_steps` array — suggested follow-up actions

Hold the full response for the incorporation step.

**If the Codex skill fails** (authentication error, CLI unavailable, timeout), note the failure and continue to Step 6 (open questions loop), skipping Step 5. Tell the user the Codex review was unavailable.

## Step 5: Incorporate Codex feedback

Process the Codex adversarial review findings and strengthen the draft plan. This step runs in the main conversation — no sub-agents.

**For each finding, by severity:**

- **Critical or high severity:** The plan has a significant gap or questionable assumption. Directly revise the relevant section (Design, Implementation, or Testing) to address the concern. Don't just acknowledge it — strengthen the plan text so the concern is resolved. If the finding identifies something genuinely missing (error handling strategy, performance risk, dependency issue), add it.
- **Medium severity:** Often surfaces unconsidered tradeoffs or dismissed alternatives. If the fix is clear, apply it. If it requires a user decision, add it to `## Open Questions` with a `[Codex]` prefix.
- **Low severity:** Apply trivially fixable suggestions (clarity, organization). Discard the rest unless they add genuine value.

**For `next_steps` from Codex:** Scan for actionable items. Those that map to user decisions become `[Codex]` open questions. Those that are purely technical and clearly correct get applied directly.

**Provenance:** When adding or revising content based on Codex findings, tag new open questions with `[Codex]` so the user knows their origin during the interview loop. Individual edits to plan sections don't need tagging.

After incorporating all findings, update the draft plan in memory (do not write to disk yet — that happens in Step 7 after the interview loop).

## Step 6: Resolve open questions (loop)

Resolve all open questions through a user interview loop. The goal is to produce a plan that needs minimal modification after the write. This loop runs in the main conversation — no sub-agents. The Step 2 sub-agent already did the deep codebase research; this step is about resolving decisions and their implications.

**For each iteration:**

1. Parse the `## Open Questions` section from the current plan draft.
2. If there are no open questions, exit the loop and proceed to Step 7.
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

## Step 7: Write the final plan document

Overwrite the draft plan (written in Step 3) with the final version. If the interview loop resolved all questions, remove the `## Open Questions` section entirely. If the loop hit the iteration cap with questions remaining, keep them in `## Open Questions` — these are genuinely unresolved and may block implementation.

## Step 8: Consistency check

Re-read the final plan end-to-end and verify there are no internal contradictions or stale text. Specifically check:

- Statements from the original draft that were invalidated by Codex feedback or user decisions but not updated (e.g., "in-memory only" surviving after a decision to persist to DB).
- Code sketches that use APIs, types, or function signatures inconsistent with the Design section (e.g., `time.monotonic()` in code when the design says `time.time()`).
- Throughput estimates or performance claims that don't match the final parameters.

Fix any issues found. This step exists because plans undergo multiple rounds of revision (draft → Codex incorporation → user decisions) and each round can leave stale text behind.

## Step 9: Present to the user

After writing the plan, give the user a brief summary of:
- Where the plan was saved
- The key design decisions made
- Whether the Codex adversarial review ran and what it surfaced (briefly — e.g., "Codex flagged 2 risks that were incorporated into the Design section")
- Any deferred questions that remain

Don't recite the whole plan back — they can read the file. Focus on decisions they should weigh in on.
