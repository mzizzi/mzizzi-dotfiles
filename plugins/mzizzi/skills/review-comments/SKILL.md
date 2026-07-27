---
name: review-comments
description: Review code comments in a set of changes — flagging narration, diff-history notes, and redundant comments while preserving genuine "why" explanations. Reviews your uncommitted local changes by default; pass "pr" to review the current branch's PR, or a PR number/URL to review that PR. Runs in review mode by default (report what should change, no edits); pass --fix to apply the changes locally. An optional --strictness argument selects the guideline set, "high" (the default) or "low"; high also flags long block comments and file/module headers. Use this whenever you've just written or modified code and are about to commit or open a PR, or when the user asks to review, clean up, or check comment quality.
argument-hint: "[--fix] [--strictness=high|low] [pr | <pr-number-or-url>]"
---

# Review comments

Review the comments in a set of changes against the loaded guidelines, then either suggest or apply the fixes. Work the steps in order.

## 1. Resolve the target and read its changes

The **target** is the last argument, a bare value (no flag) naming which diff is in scope. Resolve it, state the resolved target, then read the full diff:

- _(omitted — default)_ — **local**: uncommitted changes (`git diff HEAD`), plus any new untracked files (`git ls-files --others --exclude-standard`) — treat a new file's whole content as added.
- `pr` — the current branch's PR (`gh pr diff`; if no open PR, say so and fall back to local).
- a **PR number or URL** — that specific PR (`gh pr diff <number-or-url>`).

Unrecognized value → say so and fall back to `local`. If the resolved target has no changes at all, say there's nothing to review and stop — don't load references or invent work.

## 2. Load references (strictness)

Always read `references/acceptable-comments.md` — it lists comment categories that are OK to keep and takes precedence over the strictness rules below.

Then the `--strictness` argument (default `high`; unrecognized → `high`) selects the guideline set. Read these files relative to this `SKILL.md` and treat them as the complete, ordered rule list:

- `high` _(default)_ — `references/strictness-low.md` **and** `references/strictness-high.md` (high layers extra rules for long block comments and file/module headers on top of the base set).
- `low` — `references/strictness-low.md`.

## 3. Determine the mode

`--fix` present → **fix** mode. Otherwise → **review** mode (suggest only, no edits). Fix mode edits the working tree, so it needs the target's code checked out locally; for a `pr`/number/URL target, compare its head branch (`gh pr view <target> --json headRefName`) against the current branch, and if they differ, fall back to review mode and say why.

## 4. Process each comment

Only comments **added in the target diff** are in scope — comments on added or modified lines, not pre-existing comments that merely appear as unchanged context. Reviewing untouched code erodes trust and buries the comments that actually need attention.

For each added comment, judge it against the loaded references and decide the fix (remove, rewrite, or — where the code needs it — refactor the code to be self-documenting). Default to **cut**: the burden is on each comment to justify surviving. Then, per mode:

- **fix** — apply the change directly.
- **review** — report it: `file:line`, the current text, what's wrong, and the suggested fix. Group by file; end with a one-line offer to re-run with `--fix`.

If nothing is worth flagging, say so plainly rather than inventing changes.

In **fix** mode, after editing, re-read each touched file as a reviewer seeing it fresh: if it still reads as more comment than code, or any comment still violates a loaded guideline, cut again. Repeat until a skim shows code, not prose — err toward one more cut. Close with a short summary of what changed and what you kept and why.
