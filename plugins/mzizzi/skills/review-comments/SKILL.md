---
name: review-comments
description: Review code comments you added in the current PR or uncommitted changes —
  flagging narration, diff-history notes, and redundant comments while preserving genuine
  "why" explanations. Takes one optional mode argument: "fix" (edit the code locally,
  the default), "flag-local" (just report what would change, no edits), or "flag-github"
  (post inline review comments on the PR). Use this whenever you've just written or
  modified code and are about to commit or open a PR, or when the user asks to review,
  clean up, or check comment quality.
---

# Review comments added in this PR

This skill takes a single `mode` argument that controls what happens with the comments it
identifies:

| Mode | What it does |
| --- | --- |
| `fix` *(default)* | Edit the code locally — rewrite or remove flagged comments, refactoring code to be self-documenting where that's the right fix. |
| `flag-local` | Report in this session what *would* change. Make no edits and post nothing to GitHub. |
| `flag-github` | Post inline review comments on the PR, one per flagged comment, attached to the relevant file and line. |

If no mode is given, use `fix`. If an unrecognized value is given, briefly say so and list the
three valid modes rather than guessing.

The work happens in two steps: first identify the comments worth flagging (identical across all
modes), then act according to the mode.

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

Check each comment against the guidelines below, in order, noting each viloation:

* **Inline narration restates the code.** Remove comments that just say what the next line plainly
  does (`// increment counter`, `// loop over users`). The code already says this.
* **Change-log narration belongs in git, not the code.** Remove comments that describe your edit,
  the diff, or the history (`// changed to fix X`, `// new logic`, `// added validation`). That
  context lives in the commit message and PR description; in the code it goes stale the moment
  someone else touches the line. This includes comments that explain the *current* behavior by
  contrasting it with a former approach — "the earlier X did Y; that's now disabled",
  "previously…", "we used to…", or a parenthetical narrating what changed and why. The reader only
  needs what the code does now; the abandoned alternative is history. Cut the historical half and
  keep at most the one-line statement of current behavior (if that even needs a comment).
* **A comment that describes what the code does is not a "why" — delete it and let the code speak.**
  This is the most common survivor and the one to be hardest on. If the comment narrates the
  behavior, the control flow, the branches, or the conditions ("whether X should happen requires
  both A and B", "only these pairs fire", "skipped rather than starting…"), the code already states
  that, or should. In `fix` mode the action is to **delete the comment** — and if the code wasn't
  actually clear on its own, rename the symbol or restructure so it is, rather than keeping the
  comment as a crutch. A comment only survives this rule if it states a *non-obvious why* the code
  genuinely cannot express (see the "why" rule below). "It restates obvious behavior" is a removal,
  not a rewrite.
* **Don't mention tests, the test status, or other incidental implementation details in code
  comments.** Drop notes like "pure and unit-tested", "covered by tests", "see the test for
  examples". Whether something is tested lives in the test suite, not pinned to the implementation
  where it goes stale; and a function being "pure" is a property the signature and body already
  show. Strip the incidental clause and keep only a real why, if any remains.
* **Comments aren't a task tracker.** Drop references to Jira/Linear/GitHub issues unless they
  mark a genuine future behavioral change a reader needs to know about.
* **Long block comments and file/module headers are the worst offenders — be ruthless with them.**
  A multi-paragraph JSDoc block, a docstring that explains the architecture, a module header that
  walks through the design, what's deferred to later, what moves where, and why the whole shape is
  the way it is — that is a *design document wearing a comment's clothes.* It belongs in the PR
  description, the README, or a design doc, not pinned to the top of a source file where it rots
  the moment the architecture shifts. Cut these down hard: a file/function header earns **at most a
  one-line statement of what the thing *is*** — and most earn nothing, because the name and
  signature already say it. Concretely: if a block comment runs more than one or two lines, the
  default is to collapse it to a single line or delete it outright, not to trim a sentence and move
  on. Don't preserve the structure (intro paragraph + details + caveats) at reduced size; replace
  it. Move the rationale out of the code. A second, slightly-shorter wall of prose is still a wall
  of prose — when the user says a comment is "still" dense, the previous pass under-cut; cut to the
  one-line core this time.
* **A surviving "why" comment is short — one line, occasionally two.** Length itself is the signal.
  A genuine non-obvious *why* — a subtle invariant, a workaround for a known bug, a
  deliberate-but-surprising choice — fits in a line with a concrete reason. If the comment you
  wrote runs to several sentences or multiple paragraphs, that's not a denser "why," it's the wrong
  artifact: cut it to the single most important sentence, or move the explanation out of the code.
  Don't let a paragraph survive just because every sentence in it names a reason.
* **Volume is itself a defect — judge the comments in aggregate, not just one at a time.** A dozen
  individually-defensible comments still add up to a wall of prose that buries the code. After
  going line by line, step back and look at the whole change: if a reader would meet more comment
  than code, keep cutting until the balance tips back. New files have no existing comments to
  match, so don't read "no surrounding comments" as license to add many — a brand-new file should
  still read as mostly code.

## Step 2: Act on what you found

### Mode: `fix` (default)

Apply the changes directly to the files — remove the comments that should go, rewrite the ones
that should change, and refactor code where that's the cleaner fix.

**Then re-read each file you edited, as a reviewer seeing it fresh, before you report done.** The
common failure of this skill is cutting once, leaving a shorter-but-still-dense file, and stopping.
The first pass softens; it rarely cuts enough. So after editing, look at each touched file again
and ask the reviewer's question literally: *is there still more comment than code here? Does any
surviving block comment run more than a line or two? Does any comment restate what the code does,
mention tests, or narrate a past decision?* If yes for any of them, you are not done — cut again.
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
   For many comments, building the JSON payload and piping it to `gh api --input -` is cleaner
   than long flag lists. Keep each comment body short and concrete, and where helpful use a
   GitHub [suggestion block](https://docs.github.com/articles/incorporating-feedback-in-your-pull-request)
   (```` ```suggestion ````) so the author can apply the fix in one click.
3. A flagged line must be part of the PR's diff to be commentable inline. Since you're only
   reviewing comments *added in this PR*, those lines are in the diff. If a specific comment can't
   be attached (e.g. it sits just outside the diff hunk), fold it into the review `body` with a
   `file:line` reference instead of dropping it.
4. After posting, tell the user how many comments you posted and link to the PR.
