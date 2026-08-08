# Angle: proportionality

For each unit the diff adds or rewrites, judge whether its complexity is proportionate to the problem it solves.

Scanning won't surface these; convoluted code looks like work in isolation. Work unit by unit:

1. Write the unit's contract in one sentence — what it does, not how. If you can't, that is the finding.
2. Without re-reading the implementation, sketch the simplest version that satisfies that contract. If you can't, the implementation is handling something your contract sentence missed.
3. Compare the two. Report only when the difference is structural — fewer branches, less state, flatter control flow. A marginally shorter version is not a finding.
4. Rule out justified complexity: an extension point for dependency injection or mocking, a stable public API, an edge case your sketch dropped, a design the plan chose deliberately, a cost someone measured. Where one applies, there is no finding.

A **unit** is a function or method. Widen to the enclosing type only when the structure itself is disproportionate — a class with a single method and no state, a builder for a two-field object. Go no further; where a change sits in the system belongs to the altitude angle.

Apply the same judgment to tests the diff adds or modifies:

- Scaffolding out of proportion to the assertion: extensive fixtures behind a single equality check. Cut the scaffolding, move the assertion to a layer that carries it in one line, or delete it if it only asserts that the language works.
- Coverage another test already provides: ask what production change would make _this_ test fail first. If a stricter assertion elsewhere already fails on every such change, this one adds nothing. The same holds for an assertion implied by a structural-equality check in the same test.

The examples here are illustrative, not exhaustive; report anything in the same class.
