# Angle: proportionality

Ask one question of every unit the diff adds or rewrites: is the complexity here proportionate to the problem it solves?

A scan won't answer it — code that's convoluted for its problem trips no smell in isolation, it just looks like work. Go unit by unit instead, and take each one through three steps:

1. **Restate.** Say in one sentence what the unit does — its contract, not its steps. Struggling to write that sentence is already the finding.
2. **Re-derive.** Without re-reading the implementation, sketch the simplest version that satisfies the sentence.
3. **Compare.** Report only when the gap is large. Ten percent shorter is noise; half the size and flat where the original nested is a finding.

A **unit** is a function or method. Escalate one level only when the structure itself is the overspend — a class with a single method and no state, a builder for a two-field object. No further than that; where a change sits in the system belongs to the altitude angle.

Then follow each unit out to its tests and ask the same question of them: is the effort spent verifying this proportionate to what it verifies? Fifty lines of fixtures behind an assertion that one string equals another is the shape to notice. You can right-size it, keeping the assertions and cutting the scaffolding; consolidate, when the assertion is worth keeping but a test at another layer could carry it in a line; or delete, when behavior doesn't change or the test only asserts that the language works. Propose against tests the diff added or modified — read the pre-existing ones for the contract they establish, then leave them alone. Be reasonable about what deserves a test rather than mechanical about it: weigh the blast radius before cutting one, defer anything whose consequences you can't see clearly, and where a cut leaves a real gap, cover it trivially at the right layer.

Two gates before you propose anything, and both have to pass. **Write the replacement** — a finding doesn't exist until you can produce the simpler version and argue it does the same thing. "This could be simpler" is an impression, not a proposal, and failing to write it usually means the complexity was buying something you hadn't accounted for. **Rule out complexity that's earned** — a seam for injection or mocking, a stable public API, an edge case your sketch dropped, a shape the plan chose deliberately, a cost someone measured. Where one of those applies, there is no finding.

The shapes named here are illustrations, not a checklist. The angle is the question at the top, and anything in the same class of simplification belongs here whether or not it resembles them.
