---
name: review-comments
description: Review code comments you added in the current PR or uncommitted changes — flagging narration, diff-history notes, and redundant comments while preserving genuine "why" explanations. Takes an optional mode argument — "fix" (edit the code locally, the default), "flag-local" (just report what would change, no edits), or "flag-github" (post inline review comments on the PR) — and an optional strictness argument, "low" (the default) or "high" (also flags long block comments and file/module headers). Use this whenever you've just written or modified code and are about to commit or open a PR, or when the user asks to review, clean up, or check comment quality.
---

# Review comments added in this PR

This skill takes two optional arguments. The **`mode`** argument controls what happens with the
comments it identifies:

- `fix` *(default)*: Edit the code locally — rewrite or remove flagged comments, refactoring code to be self-documenting where that's the right fix.
- `flag-local`: Report in this session what *would* change. Make no edits and post nothing to GitHub.
- `flag-github`: Post inline review comments on the PR, one per flagged comment, attached to the relevant file and line.

If no mode is given, use `fix`. If an unrecognized value is given, briefly say so and list the
three valid modes rather than guessing.

The second argument, **`strictness`** (`low` by default, or `high`), selects *which* set of
guidelines is applied. It's resolved in Step 1 below.

The work happens in two steps: first identify the comments worth flagging (the guidelines depend on
strictness; the identification itself is the same across all modes), then act according to the mode.

## Step 1: Identify the comments to review

Scan the changes in this PR (including uncommitted changes) for explanatory comments **you added
in this PR**. Pre-existing comments are out of scope — don't flag a comment that was already
there and is still accurate, even if it's near your changes. Reviewing untouched code erodes
trust in the review and buries the comments that actually need attention.

Start from the assumption that **most comments you added can go.** When you write code you tend to
over-explain it — narrating your reasoning, documenting decisions, leaving a trail of why you did
what you did. That instinct produces comment-dense code that a proficient engineer would never have
written. So the default action here is to **cut**, and the burden is on each comment to justify its
survival, not the other way around. A reviewer skimming the file should see code, not an essay.

Check each comment against the guidelines for the chosen **strictness level**. The guidelines live
in reference files alongside this skill so the two levels can share one base set. Read the
applicable files relative to this `SKILL.md` and treat them as the complete, ordered rule list for
this run.

* **`low` *(default)*** — read `references/strictness-low.md`.
* **`high`** — read `references/strictness-high.md` **and** `references/strictness-low.md`. The high
  file layers extra rules (long block comments, file/module headers) on top of the low base set.

Resolve the level from the skill's `strictness` argument, defaulting to `low` when none is given. If
an unrecognized value is passed, briefly say so and fall back to `low`. Then work through every
guideline in the file(s) you loaded, in order, noting each violation.

## Step 2: Act on what you found

### Mode: `fix` (default)

Apply the changes directly to the files — remove the comments that should go, rewrite the ones
that should change, and refactor code where that's the cleaner fix.

**Then re-read each file you edited, as a reviewer seeing it fresh, before you report done.** The
common failure of this skill is cutting once, leaving a shorter-but-still-dense file, and stopping.
The first pass softens; it rarely cuts enough. So after editing, look at each touched file again
and ask the reviewer's question literally: *is there still more comment than code here? Does any
comment still violate a guideline you loaded — restating what the code does, mentioning tests,
narrating a past decision, or (at `high`) surviving as a multi-line block comment?* If yes for any
of them, you are not done — cut again.
Repeat until a skim of the file shows code, not prose. Err toward one more cut, not one fewer:
a comment you removed that turns out to matter is one git command to restore; a wall of prose that
survives is what the user is complaining about.

When done, give a short summary of what you changed and why, so the user has a reviewable trail
(e.g. "removed 3 inline narration comments in `auth.py`; kept the comment on the retry loop — it
explains a real race condition").

If nothing needed changing, say so plainly rather than inventing edits.

### Mode: `flag-local`

Make no edits. Report each comment you'd flag with its `file:line`, the current text, what's wrong
with it, and your suggested change (rewrite or removal). Group by file. End with a one-line offer
to apply the fixes (the user can re-run in `fix` mode). If nothing is worth flagging, say so.

### Mode: `flag-github`

Post the findings as inline comments on the PR for the current branch. Make no local edits.

This mode requires the GitHub CLI, an authenticated account with access to the repository, network
access, and permission to post a review. If any prerequisite is unavailable, or the current
environment denies approval for the external action, stop without posting and report the exact
reason. Do not silently fall back to local edits or a local-only report.

1. Resolve the PR and repo for the current branch:
   ```bash
   gh pr view --json number,headRefOid,headRepository,headRepositoryOwner
   ```
   If there's no open PR for the branch, stop and tell the user — there's nowhere to post.
2. Post the flagged comments as a single PR review so they arrive together. Use the reviews API
   with a `comments` array, each entry giving `path`, `line` (the line in the PR's diff), `side`
   (usually `RIGHT`), and a `body` explaining the issue and the suggested fix:
   ```bash
   gh api repos/{owner}/{repo}/pulls/{number}/reviews \
     -f event=COMMENT \
     -f body="Comment review: N suggestions on comments added in this PR." \
     -F 'comments[][path]=path/to/file.py' \
     -F 'comments[][line]=42' \
     -F 'comments[][side]=RIGHT' \
     -F 'comments[][body]=This narrates the code below; consider removing it.'
   ```
   The example uses Bash syntax. If the current shell differs, translate its quoting and line
   continuations before running it. For many comments, supplying a JSON payload to `gh api --input`
   is cleaner than long flag lists. Keep each comment body short and concrete, and where helpful
   use a
   GitHub [suggestion block](https://docs.github.com/articles/incorporating-feedback-in-your-pull-request)
   (```` ```suggestion ````) so the author can apply the fix in one click.
3. A flagged line must be part of the PR's diff to be commentable inline. Since you're only
   reviewing comments *added in this PR*, those lines are in the diff. If a specific comment can't
   be attached (e.g. it sits just outside the diff hunk), fold it into the review `body` with a
   `file:line` reference instead of dropping it.
4. After posting, tell the user how many comments you posted and link to the PR.
