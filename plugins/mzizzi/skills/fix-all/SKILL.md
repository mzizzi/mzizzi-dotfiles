---
name: fix-all
description: "Run the full review sweep over a change — fix-correctness, then fix-quality, then fix-comments — applying fixes and deferring the rest. Use when the user wants a change fully reviewed before committing or opening a PR, e.g. \"review and clean this up\"."
argument-hint: "[--apply=none|all] [--plan <path to plan.md>] [--strictness=high|low] [local | pr | <pr-number-or-url>]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Skill, TaskCreate, TaskUpdate, TaskList
disable-model-invocation: false
user-invocable: true
---

# Fix all

Run the three fix skills over one change, in order, then check nothing broke. Each pass has its own argument surface, so this skill parses the union once and hands each pass only what it understands.

## 1. Parse the arguments

Flags may appear in any order; the **target** is the bare value left over, and there may not be one.

- `--apply=none|all` — goes to all three. `none`: every pass reviews and reports, nothing is applied or written. `all`: each pass applies its large findings instead of deferring them.
- `--plan <path>` — goes to fix-correctness and fix-quality, which write their deferred findings into that plan's Follow-ups. fix-comments has no such argument; don't pass it one.
- `--strictness=high|low` — fix-comments only.
- the **target** — `local` (the default), `pr`, or a PR number/URL.

State what you parsed in one line before starting. Three passes run on whatever you resolved, so a misparse is much cheaper caught here.

## 2. Note what the target means for fix-correctness

fix-quality and fix-comments take the same target tokens with the same meanings, so pass the user's target to both unchanged, or omit it from both when there wasn't one.

fix-correctness takes no target at all — it always reviews the working tree. Against a PR target it will either review uncommitted changes that aren't in that PR, or find a clean tree and stop; either way say which in the report, rather than letting a pass that did nothing read as a pass that found nothing.

## 3. Run the passes

Seed a task per pass plus one for verification, chained with blocked-by so the order is fixed while changing it is still free. Then run them in order, each with the arguments resolved above:

    Skill(skill: "fix-correctness", args: "[--plan <path>] [--apply=<value>]")
    Skill(skill: "fix-quality",     args: "[<target>] [--plan <path>] [--apply=<value>]")
    Skill(skill: "fix-comments",    args: "[--strictness=<value>] [--apply=<value>] [<target>]")

Omit any argument the user didn't give. fix-comments reads its target as the last argument, so keep it there.

Correctness runs first so the later passes clean up code that's already right, and comments run last because the first two passes add narration of their own.

Read each pass's report before starting the next. A verification failure or an unavailable review is a decision point — deal with it here rather than carrying it into the next pass.

## 4. Verify

Skip this under `--apply=none`: nothing changed, so there's nothing to check.

Run the project's tests and linters. Three passes editing the same files in sequence is exactly where a cleanup that was supposed to preserve behavior turns out not to.

## 5. Report

A section per pass — they answer different questions — then the verification you ran and its result, quoting any failure. With `--plan`, name the follow-ups the correctness and quality passes recorded, so the user sees what landed there without opening the file.
