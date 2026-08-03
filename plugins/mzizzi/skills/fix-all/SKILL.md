---
name: fix-all
description: Wrapper skill for fix-correctness, fix-quality, and fix-comments.
argument-hint: "[--dry-run] [--plan <path to plan.md>] [--strictness=high|low] [local | pr | <pr-number-or-url>]"
allowed-tools: Read, Grep, Glob, Bash, Edit, Skill, TaskCreate, TaskUpdate, TaskList
disable-model-invocation: false
user-invocable: true
---

# Fix all

Run the three fix skills over one change, in order, then check nothing broke. Each pass has its own argument surface, so this skill parses the union once and hands each pass only what it understands.

## 1. Parse the arguments

Flags may appear in any order; the **target** is the bare value left over, and there may not be one.

- `--dry-run` — goes to all three: every pass reviews and reports, nothing is applied or written.
- `--plan <path>` — goes to fix-correctness and fix-quality, which write their deferred findings into that plan's Follow-ups. fix-comments has no such argument; don't pass it one.
- `--strictness=high|low` — fix-comments only.
- the **target** — `local` (the default), `pr`, or a PR number/URL.

State what you parsed in one line before starting. Three passes run on whatever you resolved, so a misparse is much cheaper caught here.

## 2. Translate the target for each pass

fix-quality defaults to the branch's PR and calls the working tree `local`; fix-comments defaults to the working tree and calls the PR `pr`. Passing either one the user's bare token, or passing nothing through, aims them at opposite diffs — so translate:

| target            | fix-quality            | fix-comments           |
| ----------------- | ---------------------- | ---------------------- |
| omitted / `local` | `local`                | _(omit — its default)_ |
| `pr`              | _(omit — its default)_ | `pr`                   |
| PR number or URL  | the number/URL         | the number/URL         |

The omissions are load-bearing, not gaps.

fix-correctness takes no target at all — it always reviews the working tree. Against a PR target it will either review uncommitted changes that aren't in that PR, or find a clean tree and stop; either way say which in the report, rather than letting a pass that did nothing read as a pass that found nothing.

## 3. Run the passes

Seed a task per pass plus one for verification, chained with blocked-by so the order is fixed while changing it is still free. Then run them in order, each with the arguments resolved above:

    Skill(skill: "fix-correctness", args: "[--plan <path>] [--dry-run]")
    Skill(skill: "fix-quality",     args: "[<target>] [--plan <path>] [--dry-run]")
    Skill(skill: "fix-comments",    args: "[--strictness=<value>] [--dry-run] [<target>]")

Omit any argument the user didn't give. fix-comments reads its target as the last argument, so keep it there.

Correctness runs first so the later passes clean up code that's already right, and comments run last because the first two passes add narration of their own.

Read each pass's report before starting the next. A verification failure or an unavailable review is a decision point — deal with it here rather than carrying it into the next pass.

## 4. Verify

Skip this under `--dry-run`: nothing changed, so there's nothing to check.

Run the project's tests and linters. Three passes editing the same files in sequence is exactly where a cleanup that was supposed to preserve behavior turns out not to.

## 5. Report

A section per pass — they answer different questions — then the verification you ran and its result, quoting any failure. With `--plan`, name the follow-ups the correctness and quality passes recorded, so the user sees what landed there without opening the file.
