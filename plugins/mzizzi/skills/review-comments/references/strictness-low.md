* **Inline narration restates the code.** Remove comments that just say what the next line plainly
    does (`// increment counter`, `// loop over users`). The code already says this.
* **Section separator comments** Header style "----" or "***" separating sections of code are never acceptable.
* **Volume is itself a defect — judge the comments in aggregate, not just one at a time.** A dozen
    individually-defensible comments still add up to a wall of prose that buries the code. After
    going line by line, step back and look at the whole change: if a reader would meet more comment
    than code, keep cutting until the balance tips back. New files have no existing comments to
    match, so don't read "no surrounding comments" as license to add many — a brand-new file should
    still read as mostly code.
* **Don't mention tests, the test status, or other incidental implementation details in code
    comments.** Drop notes like "pure and unit-tested", "covered by tests", "see the test for
    examples". Whether something is tested lives in the test suite, not pinned to the implementation
    where it goes stale; and a function being "pure" is a property the signature and body already
    show. Strip the incidental clause and keep only a real why, if any remains.
* **Comments aren't a task tracker.** Drop references to Jira/Linear/GitHub issues unless they
  mark a genuine future behavioral change a reader needs to know about.
* **A comment that describes what the code does is not a "why" — delete it and let the code speak.**
    This is the most common survivor and the one to be hardest on. If the comment narrates the
    behavior, the control flow, the branches, or the conditions ("whether X should happen requires
    both A and B", "only these pairs fire", "skipped rather than starting…"), the code already states
    that, or should. In `fix` mode the action is to **delete the comment** — and if the code wasn't
    actually clear on its own, rename the symbol or restructure so it is, rather than keeping the
    comment as a crutch. A comment only survives this rule if it states a *non-obvious why* the code
    genuinely cannot express (see the "why" rule below). "It restates obvious behavior" is a removal,
    not a rewrite.
* **Change-log narration belongs in git, not the code.** Remove comments that describe your edit,
    the diff, or the history (`// changed to fix X`, `// new logic`, `// added validation`). That
    context lives in the commit message and PR description; in the code it goes stale the moment
    someone else touches the line. This includes comments that explain the *current* behavior by
    contrasting it with a former approach — "the earlier X did Y; that's now disabled",
    "previously…", "we used to…", or a parenthetical narrating what changed and why. The reader only
    needs what the code does now; the abandoned alternative is history. Cut the historical half and
    keep at most the one-line statement of current behavior (if that even needs a comment).
* **A surviving "why" comment is short — one line, occasionally two.** Length itself is the signal.
  A genuine non-obvious *why* — a subtle invariant, a workaround for a known bug, a
  deliberate-but-surprising choice — fits in a line with a concrete reason. If the comment you
  wrote runs to several sentences or multiple paragraphs, that's not a denser "why," it's the wrong
  artifact: cut it to the single most important sentence, or move the explanation out of the code.
  Don't let a paragraph survive just because every sentence in it names a reason.