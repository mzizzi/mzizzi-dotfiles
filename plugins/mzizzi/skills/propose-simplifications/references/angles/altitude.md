# Angle: altitude

Check that each change sits at the right depth in the system, rather than patching a symptom where
it happened to surface.

This is the angle that reads the change against the architecture around it, so it needs the most
context. Follow the call path: where does the input come from, who else hits this code, and is the
place being modified actually where the problem lives?

Signals that a change is too shallow:

- **Special cases layered onto shared infrastructure** — an `if` for one caller, one file type, one
  environment, inside code everything routes through. Each one is cheap; the tenth one makes the
  shared path unreadable. The fix is usually to generalize the underlying mechanism so the special
  case stops being special.
- **Defensive patching downstream** — normalizing, re-checking, or repairing a value that should
  have been correct where it was produced. Ask why it arrives wrong.
- **Repeated fixes to the same seam** — if the diff patches something the history shows patched
  before, the seam itself is the problem.
- **Logic at the wrong layer** — business rules in a transport handler, formatting in a data model,
  a permission check in a view. Misplaced logic gets missed when a second caller appears.
- **A caller compensating for its callee** — every caller doing the same fixup afterward means the
  callee should be doing it.

Signals a change is too *deep* — this happens too, and costs more:

- Reworking a shared mechanism to serve one new caller, when a local change would have done and the
  generalization is speculative.
- Introducing an abstraction layer for a single implementation.

Two things to hold onto. **A shallow fix is sometimes the right call** — under a deadline, or where
the deep fix needs a migration. Say what the deeper fix would be and let the author decide; don't
assume they missed it. And **deep proposals are expensive**, so be straight about it: mark them
`invasive`, note what else would need to move, and expect this angle to produce the fewest
proposals. One well-argued altitude finding is worth more than five shallow observations.
