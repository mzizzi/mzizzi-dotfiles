---
name: retro
description: End-of-session retrospective that analyzes conversation feedback and proposes changes to .claude/rules/, skills, or CLAUDE.md. Use when the user says /retro, asks to capture session learnings, or wants to turn repeated corrections into durable project configuration.
allowed-tools: Read, Grep, Glob, Edit, Write, AskUserQuestion, Skill
---

# Session Retrospective

Analyze the current conversation to extract feedback that should become durable project rules or CLAUDE.md changes. The goal is to maintain concise, effective rules — making no changes is better than making low-value suggestions. If nothing in the conversation meets the bar, say so and move on.

## What qualifies as high-value feedback

The bar is high. Only surface feedback that meets **both** criteria:

1. **Project-specific** — Something Claude would get wrong again in a future session without explicit guidance. Architecture decisions, layering boundaries, naming conventions, domain concepts, API quirks, workflow requirements specific to this codebase.

2. **Broadly applicable** — Applies across large parts of the codebase or many future tasks, not a one-off fix for a single function. A rule about how all services should handle caching qualifies. A correction about one function's return type does not.

### What to look for

- **Repeated corrections** — The user said "no, don't do X" more than once, or corrected the same class of mistake across different parts of the code. The repetition signals Claude's defaults are wrong for this project.
- **Architectural guidance** — The user explained how layers interact, where responsibilities live, what abstraction boundaries exist. These are hard to infer from code alone because the code shows *what is* but not *what should be*.
- **Confirmed non-obvious approaches** — The user validated a choice that went against common practice or Claude's defaults. Without capturing this, future sessions will revert to the default.
- **Workflow requirements** — How the user wants to work: what tools to use, what order to do things in, what to avoid. These are invisible in the codebase.

### What to exclude

- **Generic best practices** — "Don't leave dead code," "use descriptive names," "write tests." Claude already knows these.
- **Things derivable from code** — File structure, import patterns, type signatures. Future sessions can read the code.
- **One-off fixes** — A bug fix or single refactor that's already in the code. The fix *is* the documentation.
- **Ephemeral state** — What's in progress, what branch is active, what's being debugged right now.

## Process

### Step 1: Mine the conversation

Read through the full conversation and identify every instance where the user:
- Corrected your approach or output
- Explained a project-specific rule or convention
- Rejected a change and explained why
- Confirmed a non-obvious approach worked

For each, note the user's words (not your interpretation) and the underlying principle.

### Step 2: Generalize and deduplicate

Group related corrections into themes. A user who said "don't reach through the service to the DB," "the CLI shouldn't manage sync timestamps," and "service methods should build real API requests" is expressing one principle: the service layer is the abstraction boundary.

Generalize from specific instances to reusable rules. The rule should make sense to a future Claude session that has never seen this conversation.

### Step 3: Check for overlap

Before proposing anything, read the existing configuration:
- `.claude/CLAUDE.md`
- All files in `.claude/rules/`

If an existing rule already covers the feedback, skip it — or propose a refinement if the existing rule is incomplete.

### Step 4: Write draft proposals to disk

Write the draft proposals to `.nocommit/retro-proposals.md` so Codex can review them. Use this format:

```markdown
# Retro Proposals (Draft)

## Proposal N: <short title>
**Target:** `.claude/rules/<topic>.md` (new) | `.claude/rules/<existing>.md` (edit) | `.claude/CLAUDE.md` (edit)
**Source:** "<quote from user's feedback>"
**Why it's durable:** <why a future session would get this wrong without the rule>
**Change:**
<full file content for new rules, or the specific edit for updates>
```

Writing the draft to disk serves two purposes:
1. It creates a working tree diff that Codex can review in the next step.
2. It provides a save point — if the session is interrupted, the draft is not lost.

If there are no proposals worth making, write that conclusion to the file ("No proposals — nothing in this session met the bar") and skip Steps 5–6. Tell the user and stop.

### Step 5: Codex adversarial review

Invoke the Codex adversarial review skill to get a cross-model challenge of the draft proposals from GPT-5.4:

    Skill(skill: "codex:adversarial-review", args: "--wait --scope auto focus on whether these retro proposals are truly durable, project-specific, and broadly applicable — challenge overly narrow rules, rules that restate generic best practices, rules that conflict with existing configuration, and rules whose feedback source doesn't support the generalization in .nocommit/retro-proposals.md")

The focus text steers Codex toward retro-quality concerns: are these rules worth adding? The `--wait` flag ensures results return before the next step.

The output is structured JSON with:
- `verdict` — overall assessment
- `summary` — brief narrative
- `findings` array — each with `severity`, `title`, `body`, `file`, `line_start`, `line_end`, `confidence`, `recommendation`
- `next_steps` array — suggested follow-up actions

Hold the full response for the incorporation step.

**If the Codex skill fails** (authentication error, CLI unavailable, timeout), note the failure and continue to Step 7 (present proposals), skipping Step 6. Tell the user the Codex review was unavailable.

### Step 6: Incorporate Codex feedback

Process the Codex adversarial review findings and refine or cull the draft proposals. This step runs in the main conversation — no sub-agents.

**For each finding, by severity:**

- **Critical or high severity:** The proposal has a fundamental problem — it's not project-specific, conflicts with existing rules, or the source feedback doesn't support the generalization. Either **drop the proposal entirely** or **substantially rework it** to address the concern. Don't just acknowledge the finding — resolve it.
- **Medium severity:** Often surfaces overreach (rule is too broad), underreach (rule is too narrow to be useful), or redundancy with existing configuration. Tighten or broaden the proposal as appropriate. If it requires a judgment call, keep the proposal but add a note for the user.
- **Low severity:** Apply wording improvements. Discard findings that are stylistic preferences.

**For `next_steps` from Codex:** Scan for actionable items. Those that suggest checking existing rules for conflicts — do the check. Those that suggest the proposal is fine — move on.

**Provenance:** When modifying a proposal based on Codex feedback, add a brief `[Codex]` note explaining what changed and why so the user can evaluate the reasoning.

After incorporating all findings, finalize the proposals in memory for presentation.

### Step 7: Present proposals

Present each final proposal using this format:

```
### Proposal N: <short title>
**Target:** `.claude/rules/<topic>.md` (new) | `.claude/rules/<existing>.md` (edit) | `.claude/CLAUDE.md` (edit)
**Source:** "<quote from user's feedback>"
**Why it's durable:** <why a future session would get this wrong without the rule>
**Change:**
<full file content for new rules, or the specific edit for updates>
```

If any proposals were dropped or modified due to Codex feedback, briefly note this after the proposals:
- Proposals dropped and why
- Proposals modified and what changed

#### Where changes go

- **New rules** go in `.claude/rules/<topic>.md`. Use kebab-case filenames that describe the topic (e.g., `api-services.md`, `database-access.md`). Match the format of existing rule files — a heading, context, then specific guidelines.
- **Edits to existing rules** modify the relevant file in `.claude/rules/`.
- **Top-level project instructions** (entry points, tool usage, skill invocations) go in `.claude/CLAUDE.md`.
- **Skill updates** are rare from a retro. Only propose a skill edit if the feedback reveals a missing step or incorrect instruction in the skill's workflow — not for general coding conventions, which belong in rules.

### Step 8: Apply approved changes

Wait for the user to approve, reject, or modify each proposal. Apply only what's approved. Present all proposals at once so the user can review them together and approve/reject individually.

After applying changes, clean up the draft file (delete `.nocommit/retro-proposals.md`).
