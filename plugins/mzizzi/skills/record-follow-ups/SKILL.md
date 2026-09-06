---
name: record-follow-ups
description: "Write follow-up items into a plan document's Follow-ups section in the standard shape. Use when deferred work needs to land in a plan — a review finding not being fixed this round, a postponed decision — or on \"record a follow-up\" / \"defer this into the plan\"."
argument-hint: "<path to plan.md> <follow-up items>"
allowed-tools: Read, Grep, Edit, Write
disable-model-invocation: false
user-invocable: true
---

# Record follow-ups

Turn one or more deferred findings into properly shaped entries in a plan document's `## Follow-ups` section. This skill writes to exactly one file — the plan it was given — and changes nothing else in it.

## 1. Resolve the plan and the items

The **first argument** is the plan document path. Read it in full: you need its existing follow-ups to avoid duplicating one, and its content to judge whether an item is already covered elsewhere. If the path doesn't exist or names a directory, say so and stop rather than going looking for a plan somewhere else.

**Everything after it** is the items to record — one or more, in whatever shape the caller had them: prose, a review finding, a bullet list. Split them into distinct findings. Two symptoms of one underlying problem are one entry; two unrelated problems in the same file are two.

## 2. Shape each entry

Fill the four fields from what the caller gave you and from the plan you just read. Never invent one. If a field genuinely isn't determinable, drop that line rather than guessing — a missing **Where** is honest, a wrong one sends a reviewer to the wrong file.

<!-- prettier-ignore -->
```markdown
### <short title>
- **What:** the issue, in a sentence or two.
- **Where:** file:line (or the area affected).
- **Why deferred:** the fact you can't get, the decision only the user can make, or the separate change it belongs to. "Out of scope for this round" is not a reason.
- **Suggested fix:** the direction the review proposed, if it holds up.
```

The title is what a reviewer scans, so name the problem rather than the remedy — "clip URLs leak on unmount", not "add a cleanup handler".

Write for someone picking this up cold, months from now, without the conversation that produced it. Anything that only makes sense in the context of this session needs spelling out here.

## 3. Place them

The section lives at the end of the plan, under a heading spelled exactly `## Follow-ups` — same case, same hyphen. Three cases:

- **Section exists, holding only the `_None yet._` placeholder** (bulleted or not) — replace that line with your entries, and leave the section's existing blurb alone.
- **Section exists with real entries** — append after the last one.
- **No section** — create it at the end of the document:

<!-- prettier-ignore -->
```markdown
## Follow-ups

Findings from the implementation review that were not fixed in this round.
```

Before appending, check what's already recorded. A finding already there gets left alone rather than duplicated; if yours carries detail the existing entry lacks, extend that entry instead of writing a second one.

Touch nothing else in the plan. Reformatting untouched sections buries the change you were asked to make.

## 4. Report

Name the plan file and list the titles you wrote, one line each. Then anything you didn't write and why: entries skipped as already recorded, entries merged into an existing one, and any field you dropped for want of information.
