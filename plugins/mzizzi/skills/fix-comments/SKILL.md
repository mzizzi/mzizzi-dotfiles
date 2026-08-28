---
name: fix-comments
description: "Cut narration, diff-history notes, and redundant comments from a change while preserving genuine \"why\" explanations. Use before committing or opening a PR, or when the user asks to review or clean up comment quality."
argument-hint: "[--apply=none|all] [--strictness=high|low] [local | pr | <pr-number-or-url>]"
allowed-tools: Read, Grep, Glob, Bash, Edit
disable-model-invocation: false
user-invocable: true
---

# Fix comments

Review the comments in a set of changes against the loaded guidelines, then apply the fixes. Work the steps in order.

## 1. Resolve the target and read its changes

The **target** is the last argument, a bare value (no flag) naming which diff is in scope. Resolve it, state the resolved target, then read the full diff:

- _(omitted — default)_ or `local` — uncommitted changes (`git diff HEAD`), plus any new untracked files (`git ls-files --others --exclude-standard`) — treat a new file's whole content as added.
- `pr` — the current branch's PR (`gh pr diff`; if no open PR, say so and fall back to local).
- a **PR number or URL** — that specific PR (`gh pr diff <number-or-url>`).

Unrecognized value → say so and fall back to `local`. If the resolved target has no changes at all, say there's nothing to review and stop — don't load references or invent work.

## 2. Load references (strictness)

Always read `references/acceptable-comments.md` — it lists comment categories that are OK to keep and takes precedence over the strictness rules below.

Then the `--strictness` argument (default `high`; unrecognized → `high`) selects the guideline set. Read these files relative to this `SKILL.md` and treat them as the complete, ordered rule list:

- `high` _(default)_ — `references/strictness-low.md` **and** `references/strictness-high.md` (high layers extra rules for long block comments and file/module headers on top of the base set).
- `low` — `references/strictness-low.md`.

## 3. Determine the mode

**Fix** is the default — the fixes get applied. `--apply=none` → **dry-run** mode: report what would change and edit nothing. `--apply=all` behaves as the default; comment fixes have no size tier.

Fix mode edits the working tree, so it needs the target's code checked out locally. `local` and `pr` always are — `pr` resolves to this branch's own PR. A **number or URL** might not be, so check: `gh pr view <number-or-url> --json headRefOid` against `git rev-parse HEAD`. If they differ, fall back to dry-run mode and say why. Comparing commits rather than branch names is what catches a fork reusing the branch name, or a local branch sitting behind the PR head — either would otherwise apply someone else's diff to your files.

## 4. Process each comment

Only comments **added in the target diff** are in scope — comments on added or modified lines, not pre-existing comments that merely appear as unchanged context. Reviewing untouched code erodes trust and buries the comments that actually need attention. One exception: a pre-existing comment whose _subject_ the diff changed is in scope, because the diff created the drift even though the comment line itself is unchanged.

For each added comment, judge it against the loaded references and decide the fix (remove, rewrite, or — where the code needs it — refactor the code to be self-documenting). Default to **cut**: the burden is on each comment to justify surviving. Then, per mode:

- **fix** — apply the change directly.
- **dry-run** — report it: `file:line`, the current text, what's wrong, and the suggested fix. Group by file; end with a one-line offer to re-run without `--apply=none`.

When a rule fires on one comment, sweep the rest of the changed files for the same class of offender and handle every instance in this pass. One violation is evidence of a habit, not an isolated slip — being pointed at the second and third instance means the sweep didn't happen.

If nothing is worth flagging, say so plainly rather than inventing changes.

In **fix** mode, after editing, re-read each touched file as a reviewer seeing it fresh: if it still reads as more comment than code, or any comment still violates a loaded guideline, cut again. Repeat until a skim shows code, not prose — err toward one more cut. Close with a short summary of what changed and what you kept and why.
