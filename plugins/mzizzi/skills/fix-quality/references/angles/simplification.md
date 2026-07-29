# Angle: simplification

Find unnecessary complexity the diff adds, and name the simpler form that does the same job.

What to look for:

- **Redundant or derivable state** — a field, flag, or variable that can always be computed from something else nearby. Two sources of truth for one fact will drift.
- **Copy-paste with slight variation** — three branches that differ in one value usually want a lookup or a parameter. (If the duplication is against code _outside_ the diff, that's the reuse angle's territory.)
- **Deep nesting** — guard clauses and early returns usually flatten it. Nesting past three levels is where readers start losing the thread.
- **Nested ternaries and dense one-liners** — a switch or an if/else chain reads plainly and debugs plainly. Fewer lines is not the goal.
- **Dead code left behind** — a branch the new logic can't reach, a parameter nobody passes, an import nothing uses, a flag with one caller that always sets it the same way.
- **Names that make the reader work** — a variable whose meaning only becomes clear three lines later, or a function whose name describes its implementation rather than its purpose.
- **Comments compensating for unclear code** — sometimes the fix is the code, not the comment. Comment quality on its own belongs to `/mzizzi:fix-comments`; only raise it here when restructuring the code is what makes the comment unnecessary.

The discipline that matters on this angle is knowing when to stop. You are looking for complexity that isn't paying for itself, not for the shortest possible version. Don't propose anything that:

- collapses several concerns into one function or component to save lines
- removes an abstraction that's organizing the code, even if it currently has one caller
- replaces something explicit and obvious with something compact and clever
- makes the code harder to step through in a debugger or extend next quarter

If a change would make you pause when reading it cold in six months, it isn't a simplification.
