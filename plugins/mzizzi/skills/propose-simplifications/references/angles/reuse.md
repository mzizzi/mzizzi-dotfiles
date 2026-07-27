# Angle: reuse

Find new code that re-implements something the codebase already has.

Go looking rather than waiting to notice. For each meaningful block the diff adds, grep the shared
and utility modules, the files next to the change, and anywhere the repo keeps common helpers. Names
are unreliable — the existing helper is often called something you wouldn't guess — so search by
what the code *does*: the string it formats, the error it wraps, the retry it performs.

A proposal here is only useful if it names the specific existing thing to call instead, with its
path. "This looks like it might already exist somewhere" wastes the author's time; finding the
helper is the work.

Also worth flagging:

- A near-copy of an existing helper with one small difference — usually the helper wants a parameter
  rather than a twin.
- Hand-rolled versions of things the language's standard library or an already-imported dependency
  provides. Check what the file imports before proposing a new dependency, and don't propose adding
  one just to delete a few lines.
- The same new logic appearing two or three times *within* the diff itself, which is the moment it
  becomes worth extracting.

Where you shouldn't push: duplication that exists because the two copies are genuinely diverging, or
because coupling them would tie together things that change for different reasons. A little
duplication is cheaper than the wrong abstraction, and the author may already have decided that.

If the diff is the *second* copy of something and the right fix is extracting a shared helper from
both, say so — but count that as `contained` or `invasive` effort, since it touches code outside the
diff.
