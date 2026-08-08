---
name: fix-correctness
description: Run a Codex adversarial review over the working-tree diff, triage what it finds, apply the fixes that are trivial and in scope, and defer the rest as follow-ups. Pass a plan file and the review also checks fidelity to it, with deferred findings written into its Follow-ups section; pass --dry-run to review and report without changing anything. Correctness only — bugs, edge cases, error handling — not comment or quality cleanup. Use this whenever a change needs a correctness review acted on rather than just reported, or when the user says "review this for bugs and fix them" or "check this is correct before I open a PR".
argument-hint: "[--plan <path to plan.md>] [--dry-run]"
allowed-tools: Read, Grep, Glob, Edit, Write, Bash, AskUserQuestion, Skill
disable-model-invocation: false
user-invocable: true
---

# Fix correctness

Run a cross-model adversarial review of a change, then act on what it finds: apply the fixes that are trivial and belong in this round, defer the rest, report both. Correctness only — comment quality belongs to `/mzizzi:fix-comments`, reuse and simplification to `/mzizzi:fix-quality`. Work the steps in order.

## 1. Resolve the arguments

The target is always the **working-tree diff** — uncommitted changes on the current branch. Check there are some (`git status --short`); if the tree is clean, say so and stop rather than widening scope to find work.

**`--plan <path>`** is optional. Given one, step 2 steers the review toward fidelity to that plan, and step 5 writes deferred findings into it. Without it, deferred findings stay in the report.

**`--dry-run`** is optional: review and report, change nothing. Steps 4 and 5 are skipped, so nothing is applied and nothing is written — including to `--plan`, if both were passed.

## 2. Run the review

    Skill(skill: "codex-adversarial-review", args: "--scope auto focus on correctness, edge cases, error handling. Right-size each recommendation to the problem — KISS/YAGNI/DRY balanced against the complexity the change actually warrants; no guards, retries, or abstraction for failures this diff does not exhibit.")

With `--plan`, append `, and whether the implementation faithfully follows the plan at <plan path>` to that focus text. `--scope auto` picks up the working-tree diff.

On success the output is prose, not JSON: a `Verdict:` line and summary, a `Findings:` list (`- [severity] title (file:line-range)`, body, optional `Recommendation:`), and `Next steps:`. Hold it for step 3.

**If the review is unavailable** (plugin not installed, authentication error, CLI unavailable, another runtime failure), it returns a failure reason instead of a report. Say it was unavailable and why, then stop — there are no findings to act on, and the rest of this skill has nothing to do.

## 3. Triage the findings

Three judgments per finding:

1. **Valid or noise?** Discard overzealous flags — stylistic nits, concerns the plan addresses elsewhere, misreadings of the code. Say briefly why you discarded anything non-obvious, so the author can object.
2. **Fix now or defer?** Fix-now belongs with this change: a correctness bug, a missing edge case central to what was just built. Defer is real but out of scope for keeping the round tight.
3. **Trivial or needs thought?** Trivial is small, local, and obviously correct. Needs-thought means design decisions, many call sites, or non-obvious tradeoffs.

When the fix-now/defer call is really a scope judgment the author should own, ask with AskUserQuestion rather than deciding for them.

## 4. Apply what's trivial

**Skip this step under `--dry-run`** — everything valid goes to the report as deferred instead.

Apply every finding that is **valid AND fix-now AND trivial**. Everything else that's valid is deferred.

Then run the project's verification — typecheck, tests, lint, whatever the repo defines. A "trivial" fix that broke something has to surface here, not in the author's next run. If something fails and the fix isn't immediately obvious, revert that finding and move it to the deferred list with the failure noted.

## 5. Record what you deferred

**Skip this step under `--dry-run`** — a dry run writes nothing, `--plan` or not. Say in the report that the plan was left untouched, so nobody goes looking for entries that aren't there.

**Without `--plan`** — deferred findings stay in the report below. Nothing is written anywhere.

**With `--plan <path>`** — hand them to the skill that owns the format:

    Skill(skill: "record-follow-ups", args: "<plan path> <the deferred findings>")

Give it each finding's `file:line`, what the issue is, why you deferred it rather than fixing it, and the fix Codex proposed where that holds up. It shapes and places the entries, dedups against what the plan already carries, and reports back what it wrote.

## 6. Report

Open with the review's verdict and a one-line assessment: what it found and what you did about it.

Every finding the review returned appears exactly once across the sections below — **Fixed**, **Fixed in weaker form**, **Deferred**, or **Discarded**. State the count the review reported, so the sections visibly reconcile against it. A finding that reaches the author in none of these states is one you dropped without deciding to.

**Fixed** — one line each: `file:line`, what was wrong, what changed. Name the verification you ran and its result, quoting any failure.

**Fixed in weaker form** — the outcome that otherwise hides inside **Fixed**: the edit you made is not one the review would recognize as its recommendation — half of a two-part fix, or a narrower change that leaves the reported failure reachable by another path. One line each: what was recommended, what you did instead, and why. If the remaining exposure is real, it belongs in **Deferred** too.

**Deferred** — one line each: `file:line`, the issue, and why it wasn't fixed now. With `--plan`, say which of these landed in the plan, using the titles `record-follow-ups` reported.

**Discarded** — what the review raised that you judged noise, one line each with the reason. Say this out loud; a reader who can't see what you rejected can't tell a careful triage from a shallow one.

If the review found nothing, say so and stop. An empty result is a real one.
