# Angle: altitude

Check that each change sits at the right depth in the system rather than patching a symptom where it surfaced.

Follow the call path: where the input comes from, and who else hits this code.

Signals the change is too shallow:

- Special cases layered onto shared infrastructure: an `if` for one caller, file type, or environment inside code everything routes through. Individually cheap, collectively unreadable. Generalize the mechanism so the case takes the general path.
- Defensive patching downstream: normalizing, re-checking, or repairing a value that should have been correct where it was produced. Ask why it arrives wrong.
- Repeated fixes to the same code — the history shows this patched before; the design at that point is the problem.
- Logic at the wrong layer: business rules in a transport handler, formatting in a data model, a permission check in a view. Missed when a second caller appears.
- A caller compensating for its callee — every caller doing the same fixup means the callee should do it.

Signals the change is too deep:

- Generalizing for one caller: reworking a shared mechanism when a local change would do.
- An abstraction layer for a single implementation.

Writing the proposal:

- A shallow fix is sometimes correct. State the deeper fix and let the author decide.
- Deep proposals are `invasive`. Mark them so and note what else would have to move.
