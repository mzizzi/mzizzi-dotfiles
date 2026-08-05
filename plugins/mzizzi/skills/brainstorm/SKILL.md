---
name: brainstorm
description: "Stress-test an idea, design, or plan through a relentless, looping interview, then persist the results as a brainstorm.md decision log in a plan directory. Use this whenever the user wants to brainstorm, think an idea through before building, or capture a grilling session to disk. Also use to resume an earlier session — pointed at an existing brainstorm.md or its plan directory, it picks up from the decisions logged there and updates that file in place. Prefer this over /grill when the discussion should be persisted, and over /create-plan when the user wants to explore and capture decisions rather than produce a full implementation plan yet."
argument-hint: "[existing brainstorm.md or plan dir] <idea, design, or plan to brainstorm>"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Skill, WebFetch, WebSearch
disable-model-invocation: false
user-invocable: true
---

# Brainstorm

Brainstorm is a thin wrapper that turns a [[grill]] session into a durable artifact — the shared understanding a grilling builds evaporates when the conversation ends, so this captures it as a decision log in a date-stamped plan directory, exactly where `create-plan` later looks. The flow is: **interview (loop) → save → optionally implement.** A brainstorm can also be _resumed_: point the skill at a document an earlier session wrote and it continues that conversation instead of starting a new one.

## Step 0: New brainstorm or continuation?

Look at the first argument. It's a **continuation** if it resolves to an existing brainstorm document:

- a path to an existing `.md` file (e.g. `plans/20260625-oauth-token-refresh/brainstorm.md`), or
- a path to an existing directory that contains a brainstorm document — use `brainstorm.md` if present, otherwise the single `.md` file in it. If the directory holds several candidates and none is `brainstorm.md`, ask the user which one to continue.

Anything else — no argument, a topic description, a path that doesn't exist — is a **new brainstorm**. Don't guess a path into existence: if the user clearly meant to continue a saved brainstorm but the path doesn't resolve, say so and ask rather than silently starting fresh under a new directory.

**For a continuation:** read the document, and read any sibling documents in its directory (a `plan.md`, notes) for context. Load its `## Decisions` entries into your running record as already-settled and its `## Open questions` as the live threads — those are where the interview should pick up. Remember the resolved path; Step 3 rewrites _that_ file rather than minting a new directory. Any text the user passed after the path is the thread they want to explore next — seed Step 1 with it.

**For a new brainstorm:** the argument is the idea to explore — if there's no argument at all, ask what they'd like to brainstorm first. Then run the flow as written below.

## Step 1: Grill the user

Invoke the **grill** skill and run its interview as written — one question at a time, each through AskUserQuestion, each with a researched recommendation:

    Skill(skill: "grill", args: "<the idea/design/plan the user wants to brainstorm>")

Grill is the single source of truth for _how_ to interview; don't reinvent it here. Your only added responsibility is to **keep a running record as you go** — each decision, the option chosen, and the _why_ — plus the overall framing and any threads that surface unresolved. You'll write this into the log in Step 3.

This step repeats (see Step 2). On a second or later pass, **continue the same interview** — build on what's already settled in your running record instead of re-asking it. If the user volunteered a specific new thread when choosing to keep going, start there.

When resuming a saved brainstorm, the first pass is already a "second pass" — and if the document is thin on a decision's _why_, probe that by confirming the decision rather than reopening it.

## Step 2: Ask what's next

When a grill pass reaches a natural stopping point — the branches currently in view are resolved — check whether there's more to explore. Use AskUserQuestion with the question **"Any more questions or ideas?"** and exactly these three choices:

- **Continue brainstorming** → there's still ground to cover. Since AskUserQuestion options can't capture free text, follow the selection with an open-ended prompt ("What would you like to dig into next?") and seed the next grill pass with whatever thread they give; if they have nothing specific, resume walking the still-open branches yourself.
- **Finish and save** → go to Step 3, write `brainstorm.md`, and stop.
- **Finish and create implementation plan** → go to Step 3, then continue to Step 4 to build the plan from the brainstorm.

Keep the options in this order every pass, with `Continue brainstorming` first and marked **"(Recommended)"** — a stray selection should default to exploring more, not to saving. Treat an "Other" answer with a topic as _Continue brainstorming_ already seeded with it, skipping the follow-up prompt.

Loop Step 1 ↔ Step 2 until the user picks one of the two finish options.

## Step 3: Save the brainstorm

Both finish options land here. First resolve where the document goes.

**Continuation** — you already have the path from Step 0. Rewrite that same file in place; don't create a new directory, and don't rename the existing one even if the topic drifted. Keeping the path stable matters because a `plan.md`, a branch, or the user's own notes may already point at it.

**New brainstorm** — mint the destination directory with the **create-plan-dir** skill, passing a short topic summary:

    Skill(skill: "create-plan-dir", args: "<short topic summary>")

It stamps today's date and returns a path like `plans/20260625-oauth-token-refresh/`. Creating it _now_ — after the looping — means the directory name reflects what the conversation actually settled on. The document is `brainstorm.md` inside it.

Then write your running record to that path as a **decision log** — structured so `create-plan` can lift the settled decisions straight into the plan and only re-litigate what's genuinely open. Use this structure:

<!-- prettier-ignore -->
```markdown
# [Topic] — Brainstorm

## The idea
A few sentences framing what we explored and why — the problem, the motivation, the
context that surfaced during the interview. Enough that a future reader (or planner)
understands the intent without the original conversation.

## Decisions
One entry per settled decision, in the order they were resolved:

### [Decision topic]
- **Question:** what was being decided
- **Decision:** the option chosen
- **Why:** the reasoning — the user's rationale and/or the research behind the recommendation

## Open questions
Threads that came up but weren't resolved — things to settle during planning or
implementation. Omit this section entirely if everything got resolved.
```

Keep the **Why** lines substantive: the rationale is the most valuable thing to preserve, since a bare decision without its reasoning invites someone to second-guess it later. A Why carries the decision's _weight_, not just its direction: the evidence behind it (**checked** facts kept as stated, **not checked** ones named as such) and the tradeoff actually weighed — what the choice adds vs. removes, and what it deliberately declines to defend. If a decision was trivial, a one-line note is fine — don't pad it.

On a continuation, the rewrite is a **merge, not a replacement**: carry the original decisions forward and append this session's, rebuilding _Open questions_ from what's still live. A decision this session overturned stays in the log, its entry revised to record the new choice and why — deleting it loses the history that makes the reversal legible.

If the user chose **Finish and save**, report the saved path and mention that `/create-plan <dir>` will turn it into a plan whenever they're ready. Done.

## Step 4: Hand off to planning

Only when the user chose **Finish and create implementation plan**. Invoke `create-plan`, pointing it at the directory from Step 3 so it reuses the folder and builds `plan.md` on top of the brainstorm instead of starting cold:

    Skill(skill: "create-plan", args: "<plan dir path> — flesh out <brainstorm file name> there into a full implementation plan")

Where `<brainstorm file name>` is the document written in Step 3 — `brainstorm.md` for a new brainstorm, or whatever the continuation's file is named. If that directory already holds a `plan.md` from an earlier session, say so when handing off, so `create-plan` updates it rather than treating the plan as new work.
