# A proportionality angle for fix-quality — Brainstorm

## The idea

`fix-quality` fans out read-only reviewers over a diff, one per angle — `reuse`, `simplification`, `efficiency`, `altitude` — then filters, ranks, and applies what's contained. Two classes of problem consistently escape it, both of them things a human catches reflexively and an LLM tolerates or writes:

- **Over-engineered individual functions.** Convoluted, hard-to-follow algorithms for problems that are actually simple. The telling detail is that models fix these readily _when asked_ "can this be simplified?" — they just never ask themselves.
- **Ceremony around trivial logic.** The motivating case came from an `/mzizzi:implement-plan` run on a web app: a single-line function doing a literal string comparison for passwords, backed by ~50 LOC of tests. Wasteful, and it spends human attention during PR review that should be going somewhere else.

Neither trips the existing angles. `simplification.md` is a checklist of line-local patterns (redundant state, deep nesting, dead code) — a shallow-but-convoluted algorithm matches none of them, and "50 LOC testing `==`" isn't a line-local smell at all. `altitude.md` judges where a change sits in the system, not how much was spent on it.

The goal is to catch the whole class without over-fitting to those two examples, and without having to poke at each instance by hand.

A note that shaped several decisions: the auth example is contestable. `verify_password(a, b) -> a == b` is a security seam where `compare_digest` or bcrypt eventually lands, and "wrong password is rejected" is a genuine contract assertion. The waste there is the 47 lines of mock scaffolding, not the wrapper or the test's existence.

## Decisions

### Framing: one new angle rather than extending or splitting

- **Question:** should this be a fifth angle, new bullets on `simplification.md`, or two new angles?
- **Decision:** one new angle.
- **Why:** appending to `simplification.md` puts a whole-function judgment inside a line-local pattern list whose reviewer works line-by-line — it would get skimmed past, which is how these cases escape today. Splitting into two sharpens each prompt but costs two more agents per shard on every run and produces overlapping findings the parent has to merge. One angle built on a single question covers both cases without naming either.

### The central question, and the angle's name

- **Question:** what one question does the reviewer answer about each unit?
- **Decision:** "Is the complexity here proportionate to the problem?" → `proportionality.md`.
- **Why:** it frames a ratio between two things the reviewer establishes independently — the difficulty of the problem, and what was spent on it — and presupposes no verdict. `over-engineering.md` states a conclusion rather than asking a question, and an angle told to find over-engineering will find it, leaving the restraint gates fighting the title on every run. `judgment.md` was broad enough to swallow the other four angles.

### Mechanic: a forced per-unit pass, not a scan

- **Question:** how does the reviewer actually find these?
- **Decision:** enumerate every unit the diff adds or rewrites and, for each: state in one sentence what it does, independently sketch the simplest version meeting that same contract, compare. Report only where the gap is large.
- **Why:** this is the one mechanic grounded in evidence — models demonstrably fix convoluted code when prompted "can this be simplified?", so the angle has to force that prompt rather than offer another list of things to notice. Enumeration is what stops units getting skimmed. A threshold-triggered variant was rejected twice over: thresholds are the magic numbers the repo's documentation rule pushes back on, and the trivial-wrapper case is _short_ — it would clear every threshold and never get looked at. An open scan is the current failure mode.

### Unit granularity: function, escalating to the enclosing shape

- **Question:** what counts as a "unit"?
- **Decision:** function or method by default; escalate one level only when the structure itself is the overspend (a class with one method and no state, a builder for a two-field object).
- **Why:** the function is case (a) directly, and covers case (b) too since a wrapper is a function. Bounded escalation catches the common LLM output shape where each function is individually fine but the class wrapping them isn't, while staying clear of `altitude.md`, which already owns "abstraction layer for a single implementation". Enumerating every declaration would pay re-derive cost on type aliases to catch a few real findings.

### Restraint: both gates

- **Question:** what stops an angle whose job is "this is over-engineered" from firing on everything?
- **Decision:** two gates. Evidence — no finding exists unless the reviewer can write the actual simpler version and argue equivalence. Stop-list — rule out earned complexity first: a seam for injection or mocking, a public API, a real edge case the sketch missed, a shape the plan chose deliberately, measured performance.
- **Why:** the evidence gate is self-enforcing, since failing to write the replacement _is_ the signal the complexity might be earned. But on its own it's insufficient: a reviewer can always write something simpler by dropping a case it didn't notice mattered, and the parent lacks the context to catch that. Every existing angle file carries a restraint section; this one needs the strongest of the five.

### Tests: reached by anchor, from production code outward

- **Question:** how does the angle see impl and tests together, given sharding?
- **Decision:** the angle enumerates only units of production logic. Tests are never an enumeration target — they're reached by walking outward from an anchored unit to ask whether the verification effort matches what it's verifying.
- **Why:** this dissolves the sharding problem rather than solving it. The shard holding the impl produces the finding wherever the test lives, so no test-pairing rule in `SKILL.md` and no duplicate proposals from the shard holding `tests/`. Tests already get reviewed by the other angles when they're in the diff; what's missing is anyone judging a test _against its subject_, and the anchor rule is exactly that missing edge. Accepted trade: a test added for code outside the diff has no anchor and this angle skips it.

### Test scope: only what the diff touched

- **Question:** walking from a changed unit into its tests, which tests can be proposed against?
- **Decision:** only tests the diff added or modified. Pre-existing tests are read for context — they establish what contract the unit is held to, which the re-derive step needs — but never proposed against.
- **Why:** consistent with the reviewer contract's existing rule that a diff is not a licence to renovate, and it targets the actual case: ceremony arriving in the same change as the logic. An old bloated suite is a separate cleanup the author didn't ask for in this PR.

### Test authority: delete and consolidate, on judgment

- **Question:** what can the angle do to test code?
- **Decision:** it may right-size, delete, or consolidate. Deletion is permitted when behavior doesn't change, when the test is judged trivial or unvaluable, or when the assertions can be captured by a test at a different layer. Consolidation is a first-class move, not a fallback. The angle is instructed to be reasonable about what's worth testing rather than held to a rigid criterion.
- **Why:** flexibility is the point — a rigid "delete only if X" rule would miss the shape that actually fits the motivating example. The right fix there isn't deleting the password test, it's recognizing the assertion belongs in the login route test that already exists rather than in 50 lines of mock scaffolding around a `==`.

### Blast radius of test removal: judgment, not protocol

- **Question:** step 6 verifies applied changes by running the suite. What happens when the same pass both rewrites an impl and shrinks the suite verifying it?
- **Decision:** nothing in the parent skill. The angle file instructs the reviewer to be aware of the blast radius of removing a test — defer the ones whose consequences aren't obvious, and trivially cover gaps where it deems appropriate. No apply-ordering rule, no mandated proposal field.
- **Why:** three progressively smaller versions of this were proposed and each rejected as over-engineering — a two-phase apply-and-verify protocol, then a one-line ordering hint in step 6, then a required "what assertion moved where" field. The aggregator already makes strictly harder calls (deduping across angles, judging behavior preservation, splitting contained from invasive); sequencing two edits is well below that bar. Writing a rule into shared infrastructure to serve one angle's edge case is also what `altitude.md` flags as a special case layered onto a shared path.

### Calibration: a couple of examples, plus an explicit generalization clause

- **Question:** how concrete should the file be, given the over-fitting risk?
- **Decision:** an example shape or two, with text stating plainly that they demonstrate the concept and that the reviewer is expected to raise anything in the same class of simplification. Not a checklist; not zero examples.
- **Why:** the anti-overfit work is done by wording, not by breadth of enumeration. A broad varied list was rejected as its own kind of over-engineering — and a list is precisely what causes pattern-match-and-stop. This means a deliberate style break from the other four angle files, whose bullet lists suit pattern-scanning angles but not this one.

### Wiring: minimum, plus a sharding bullet of its own

- **Question:** how much of `fix-quality/SKILL.md` does this touch?
- **Decision:** add `proportionality.md` to step 4's angle list; give it its own bullet in step 3 alongside the existing per-angle bullets, carrying a hint that the per-unit pass is heavier than a scan so its shards want to be smaller; and make the hardcoded counts count-agnostic in `fix-quality/SKILL.md`, `fix-quality/references/reviewer.md` ("one of four independent reviewers"), and `implement-plan/SKILL.md:84` ("four quality angles"). No boundary note in the angle file — deduping across angles is already step 5's job.
- **Why:** step 3 is already structured as one bullet per angle, so this fits the existing shape rather than bolting a caveat onto someone else's bullet. Too much scope is the one way this angle degrades quietly: the forced pass blurs, and a thin result is indistinguishable from clean code. Count-agnostic wording also follows the repo's documentation rule against hardcoding counts.

## Open questions

- Should `simplification.md` shed anything now that proportionality exists, or does it stand as-is?
- Does the re-derived sketch need to appear explicitly in proposals, or does `reuse.md`'s existing `change:` field already carry it?
- Fan-out grows from four angles to five, and this is the most expensive angle per agent. Accepted for now with no gating flag — worth revisiting if runs get slow on large diffs.
