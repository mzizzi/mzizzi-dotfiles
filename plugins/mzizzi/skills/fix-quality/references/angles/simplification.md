# Angle: simplification

Find unnecessary complexity the diff adds, and name the simpler form that does the same job.

What to look for:

- Redundant or derivable state: a field, flag, or variable that can always be computed from something else nearby. Two sources of truth for one fact will drift.
- Copy-paste with slight variation — branches that differ in one value usually want a lookup or a parameter. Duplication against code _outside_ the diff belongs to the reuse angle.
- Deep nesting — guard clauses and early returns usually flatten it. Propose a flatter form when the nesting obscures the control flow.
- Nested ternaries and dense one-liners: a switch or if/else chain is readable and debuggable. Fewer lines is not the goal.
- Dead code left behind: a branch the new logic can't reach, a parameter nobody passes, an import nothing uses, a flag with one caller that always sets it the same way.
- Files in the diff only for churn: a file whose entire change is rewording, reflow, or formatting with no semantic difference. Propose reverting it so it leaves the diff. Where a real change sits alongside a reflow, propose dropping only the reflow. Check files touched by a direction the change later abandoned: the code was reverted, the comment edit was not.
- Unclear names: a variable whose meaning is not clear at its declaration, or a function whose name describes its implementation rather than its purpose.

You are looking for complexity that isn't paying for itself, not for the shortest possible version. Don't propose anything that:

- collapses several concerns into one function or component to save lines
- removes an abstraction that's organizing the code, even if it currently has one caller
- replaces something explicit and obvious with something compact and clever
- makes the code harder to step through in a debugger or extend later

If the result is harder to read than what it replaced, it isn't a simplification.
