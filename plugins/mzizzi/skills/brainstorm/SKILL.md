---
name: brainstorm
description: "Stress-test an idea, design, or plan through a looping interview, then persist the decisions as brainstorm.md in a plan directory; pointed at an existing brainstorm.md or plan dir, it resumes from what is logged there. Use when the user wants to brainstorm or think an idea through before building. Prefer over create-plan when exploring rather than committing to an implementation plan."
argument-hint: "[existing brainstorm.md or plan dir] <idea, design, or plan to brainstorm>"
allowed-tools: Read, Grep, Glob, Bash, AskUserQuestion, Write, Skill, Agent
disable-model-invocation: false
user-invocable: true
---

# Brainstorm

Interview the user to stress-test an idea, then save the decisions as a decision log that `create-plan` builds on. The flow: **interview (loop) → save → review → back to the interview on findings, otherwise exit or hand off to planning.**

## Step 0: New brainstorm or continuation?

The first argument may be a path:

- **A file whose name contains `brainstorm`, or a directory holding one:** continue that file. If a directory holds several and none is `brainstorm.md`, ask which.
- **Any other path:** a new brainstorm. A new `.md` path is the target file. A seed or notes file puts `brainstorm.md` beside it. A directory gets `brainstorm.md` inside it.
- **No path:** a new brainstorm in a new plan directory. Once you know the idea, create it with `Skill(skill: "create-plan-dir", args: "<short topic summary>")`. The target is `brainstorm.md` inside it.

If the user meant a saved brainstorm and the path doesn't resolve, say so and ask.

Read the other documents in the target directory for context. When continuing, the file's `## Decisions` are settled, and its `## Open questions` are where the interview picks up. Text after the path is the first thread, or the idea for a new brainstorm. With no idea and no seed, ask what to brainstorm.

## Step 1: Interview

Read `references/recommendation-guidelines.md` (relative to this skill's directory) once at the start.

Walk down each branch of the design tree, resolving dependencies between decisions one by one, until you and the user share an understanding of the idea. Research each fork, then state the call with its reason, or ask when the guidelines say the fork deserves a question:

- Ask one question at a time, through the harness's interactive user-question tool (e.g. `AskUserQuestion` in Claude Code) if it has one. Otherwise, write the question as numbered options and stop.
- Put the recommended option first, with "(Recommended)" on its label and the rationale in its description.
- A reply that isn't an option pick can be an answer, a question, or "you decide". Take an answer as the decision. Answer a question, then state your call with its reason; don't re-ask the same question with new framing. Make the call yourself on "you decide".

Keep a running record as you go: each decision, stated or answered, with the option chosen and the why, plus the framing. Step 3 writes it.

The deliverable is clearly-scoped chunks of work: what each delivers and why. How much to build, or what a first phase covers, is planning; don't ask it. When a branch grows past the user's stated goal, say so and ask whether it belongs before you explore it.

On a later pass, or when resuming, build on the settled record instead of re-asking it. If a resumed document is thin on a decision's why, probe it by confirming the decision, not reopening it.

## Step 2: Ask what's next

When the branches in view are resolved, ask **"Any more questions or ideas?"** with one of these option sets, in this order:

- after an interview pass: **Continue brainstorming**, **Save & Review**, **Save & Exit**
- after a clean review (Step 4): **Continue brainstorming**, **Exit**, **Create implementation plan**

- **Continue brainstorming**: ask in plain text "What should we brainstorm next?" and wait. The user's question or topic starts the next pass of Step 1.
- **Save & Review**: Step 3, then Step 4.
- **Save & Exit**: Step 3, then sign off.
- **Exit**: the document is already saved and reviewed. Sign off.
- **Create implementation plan**: Step 5.

A free-form answer to the menu is **Continue brainstorming** with that question or topic; don't ask again.

## Step 3: Save the brainstorm

**Continuation**: rewrite the file from Step 0 in place. Keep its path even if the topic drifted; other files may point at it.

**New brainstorm**: write to the target from Step 0.

Write the running record as a decision log:

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
This section should almost never be filled out. Add an entry only for a decision you
searched for extensively (code, measurements, the user) and still could not settle.
Each entry names what you tried and the fact that would settle it. Otherwise omit the
section.
```

A **Why** carries the decision's _weight_, not just its direction, so nobody second-guesses it later: the evidence behind it, with its checked / not checked labels, and the tradeoff weighed (what the choice adds vs. removes, and what it deliberately declines to defend). A trivial decision gets a one-line note.

On a continuation, **merge, don't replace**: carry the original decisions forward, append this session's, and rebuild _Open questions_ from what is still unsettled. A decision this session overturned stays in the log, revised to record the new choice and why.

## Step 4: Review

Run a pragmatic review of the document:

    Agent(subagent_type: "mzizzi:pragmatic-reviewer", prompt: "Review the brainstorm at <path to the document>.", run_in_background: false)

If the review has findings, say briefly what they are and go back to Step 1, starting from them. A finding against something the user chose goes back to them as a question; never apply it on the reviewer's word. A decision the review overturns is re-logged per the merge rule, and the next save rewrites the same file.

Otherwise, report the saved path and any `## Open questions`, then ask the Step 2 question with the post-review options.

## Step 5: Hand off to planning

Only after **Create implementation plan**:

    Skill(skill: "create-plan", args: "<plan dir path> — build plan.md from <brainstorm file path>")

## Signing off

Whenever the skill exits without handing off to planning, end your final message with this message and nothing after it:

    Brainstorm written: <brainstorm file path>
    Create a plan with: /mzizzi:create-plan <brainstorm file path>
