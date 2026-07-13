---
name: brainstorm
description: Stress-test an idea, design, or plan through a relentless, looping interview, then persist the results as a brainstorm.md decision log in a fresh plan directory. Use this whenever the user wants to brainstorm, think an idea through before building, or capture the output of a grilling session to disk — especially when they say "brainstorm", "let's think through X", "grill me and write it up", or want a saved pre-planning artifact. Prefer this over /grill when the discussion should be persisted, and over /create-plan when the user wants to explore and capture decisions rather than produce a full implementation plan yet.
argument-hint: <idea, design, or plan to brainstorm>
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Skill
---

# Brainstorm

Brainstorm is a thin wrapper that turns a [[grill]] session into a durable artifact. The grilling is great for reaching shared understanding in the moment, but that understanding evaporates when the conversation ends. Brainstorm captures it: it runs the interview — looping for as long as the user still has questions or ideas — then writes a decision log to `brainstorm.md` inside a date-stamped plan directory, exactly where `create-plan` later looks. And if the user is ready, it hands that document straight to planning.

So the flow is: **interview (loop) → save → optionally implement.**

## Step 1: Grill the user

Invoke the **grill** skill and run its interview as written — one question at a time, each through AskUserQuestion, each with a researched recommendation:

    Skill(skill: "grill", args: "<the idea/design/plan the user wants to brainstorm>")

Grill is the single source of truth for *how* to interview; don't reinvent it here. Your only added responsibility is to **keep a running record as you go**, because you'll need it to write the log later. After each question resolves, note:

- the decision being made (a short topic label),
- the option the user chose,
- the *why* — their reasoning, plus the research or rationale behind the recommendation.

Also keep a running sense of the overall framing (what we're exploring and why) and any threads that surface but don't get resolved.

This step repeats (see Step 2). On a second or later pass, **continue the same interview** — build on what's already settled in your running record instead of re-asking it. If the user volunteered a specific new thread when choosing to keep going, start there.

## Step 2: Ask what's next

When a grill pass reaches a natural stopping point — the branches currently in view are resolved — check whether there's more to explore. Use AskUserQuestion with the question **"Any more questions or ideas?"** and exactly these three choices:

- **Continue brainstorming** → there's still ground to cover. Someone who picks this usually has a specific idea in mind, so **first ask them what to explore next**: since AskUserQuestion options can't capture free text, follow the selection with an open-ended plain-text prompt (e.g. "What would you like to dig into next?") and wait for their answer. Seed the next grill pass (Step 1) with whatever thread they give, carrying your running record forward. If they'd rather you drive — they reply with nothing specific, or say to keep going — resume walking the still-open branches of the design tree on your own.
- **Finish and save** → go to Step 3, write `brainstorm.md`, and stop.
- **Finish and create implementation plan** → go to Step 3, then continue to Step 4 to build the plan from the brainstorm.

Always present these three choices **in the exact order listed above** — `Continue brainstorming`, then `Finish and save`, then `Finish and create implementation plan` — every pass, regardless of how covered the design feels. The order is static so the menu is predictable across passes and usages; do **not** reorder it to float a recommendation to the top. `Continue brainstorming` is **always** the recommended option: keep it first and append **"(Recommended)"** to its label every time. Making a finish option the recommended (top) choice risks a stray selection jumping the flow into saving or planning before the user means to — the safe default is to keep exploring, and the user can always pick a finish option deliberately. Picking "Other" and typing a thread is the one-step shortcut for the same intent — treat it as *Continue brainstorming* already seeded with that topic, and skip the follow-up prompt.

Loop Step 1 ↔ Step 2 until the user picks one of the two finish options.

## Step 3: Save the brainstorm

Both finish options land here. First mint the destination directory with the **create-plan-dir** skill, passing a short topic summary:

    Skill(skill: "create-plan-dir", args: "<short topic summary>")

It stamps today's date and returns a path like `plans/20260625-oauth-token-refresh/`. Creating it *now* — after the looping — means the directory name reflects what the conversation actually settled on.

Then write your running record to `brainstorm.md` inside that directory as a **decision log**. The point of this structure is reuse: when `create-plan` reads this file, it should be able to lift the settled decisions straight into the plan and only re-litigate what's genuinely open. Prose summaries bury that signal; a decision log surfaces it.

Use this structure:

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

Keep the **Why** lines substantive: the rationale is the most valuable thing to preserve, since a bare decision without its reasoning invites someone to second-guess it later. If a decision was trivial, a one-line note is fine — don't pad it.

If the user chose **Finish and save**, report the saved path and mention that `/create-plan <dir>` will turn it into a plan whenever they're ready. Done.

## Step 4: Hand off to planning

Only when the user chose **Finish and create implementation plan**. Invoke `create-plan`, pointing it at the directory from Step 3 so it reuses the folder and builds `plan.md` on top of the brainstorm instead of starting cold:

    Skill(skill: "create-plan", args: "<plan dir path> — flesh out the brainstorm.md there into a full implementation plan")