# fix-comments / fix-quality: gaps found in a real session

Feedback gathered from one session reviewing a Cloudflare Worker webhook adapter (`patreon_agent`, PR #329). Every item below is a correction the user had to make by hand that a skill rule could have caught. Scope is strictly code and comments; README/doc structure feedback is out.

## Cost summary

| What the user had to catch | Times | Covered today |
| --- | --- | --- |
| Comment asserted something false ("constant-time compare") | 1 | **No rule exists** |
| Verbose block comment / "worthless comment" | 3 separate pointers | Rule exists, under-applied |
| Comment defined a thing by what it _isn't_ | 2 | Only the historical variant |
| Test that cannot fail independently | 2 | **No** |
| File whose entire diff was a no-op reword | 2 | **No** |
| Field carried that nothing consumes | 1 (remove → restore) | **No, and the skill's instinct would be wrong** |

Priority order, by follow-up saved: items 1, 2, 5 first.

---

## fix-comments

### 1. Comment accuracy — the largest gap

**What happened.** A module doc claimed authenticity was "checked with a constant-time compare." The code did `token !== env.DATADOG_HOOK_SECRET`. An earlier commit had dropped `node:crypto`/`timingSafeEqual` and left the comment behind. The user caught it; two comment passes had not.

**Why the skill missed it.** Every rule in `strictness-low.md` and `strictness-high.md` judges comments on _form_ — verbosity, narration, history, issue references. None asks whether the comment is _true_. A concise, well-shaped, factually wrong comment passes every current check.

**Proposed rule** (add to `references/strictness-low.md` — belongs in the base set, since it applies at every strictness):

> - **Verify each surviving comment against the code it describes.** A comment that contradicts the code is worse than no comment, and no amount of concision saves it. For every comment you keep, check its factual claims against the implementation — the algorithm it names, the guarantee it asserts, the file or symbol it points at. Where they disagree, the comment is wrong until proven otherwise: cut it, or correct it to what the code actually does. Drift is most common where a comment survived a change to the code beneath it, so treat "this comment wasn't touched by the diff" as a reason to check it, not a reason to skip it.

**Companion scope amendment** (`SKILL.md` §4). §4 currently limits scope to comments _added_ in the diff. Had the `node:crypto` removal not also reflowed the comment, the skill would have been instructed to ignore a now-false comment sitting directly above the changed line. Add:

> Exception: a pre-existing comment whose subject the diff changed is in scope. The diff created the drift even though the comment line is unchanged.

### 2. Sweep for the same class instead of waiting to be pointed at

**What happened.** Three separate round trips for one underlying rule: the user flagged a verbose module header, then "same goes for the agent jacking comment," then a worthless sentence in a different file. Each was the same class of offender, already covered by existing rules.

**Proposed rule** (add to `SKILL.md` §4):

> When a rule fires on one comment, immediately search the rest of the changed files for the same class of offender and fix every instance in this pass. One violation is evidence of a habit, not an isolated slip — being pointed at the second and third instance means the sweep didn't happen.

### 3. Definition by negation, and absence claims

**What happened.** Two comments the user rejected:

- `// event priority ("normal"/"low"), not P1-P5`
- `All crypto goes through WebCrypto (crypto.subtle), with no Node dependencies.`

Neither is history. `strictness-low.md` covers contrast with a _former_ approach ("previously…", "we used to…") but not contrast with a different-but-confusable concept, nor assertions that something is absent. The second was also derivable — the file has zero imports.

**Proposed rule** (add to `references/strictness-low.md`):

> - **A comment that says what the code _isn't_ says nothing.** Cut contrasts with a different-but-confusable concept ("this is X, not Y"), and assertions that something is absent ("no Node dependencies", "does not retry", "not thread-safe" where nothing claimed it was). State what the thing is and stop. The exception is a genuine `DO NOT` constraint aimed at a future editor — a negation that changes what someone would do, not one that heads off a misreading the code doesn't invite.

### 4. Don't restate a contract that is canonical elsewhere

**What happened.** A module doc carried an 11-key JSON payload template that also lived in the repo README. The copies drifted: the README gained four keys the comment never got, and the comment kept the false constant-time claim after the README was corrected. Item 1 is a direct consequence of this duplication.

`strictness-high.md` says design documents belong in the README, but frames it as "move the rationale out" — it doesn't cover the case where a canonical version _already exists_ and the comment is a second copy.

**Proposed rule** (add to `references/strictness-high.md`):

> Where a comment restates a contract, schema, or config format already documented elsewhere in the repo, replace the copy with a one-line pointer to the canonical location. Two copies of a spec drift, and the copy pinned to the source file is the one that rots unnoticed.

---

## fix-quality

### 5. Tests that cannot fail independently

**What happened.** Two tests the user called worthless:

- A "tripwire" asserting `ROUTES.some(r => r.source === 'datadog') === false`, while a neighbouring test already asserted `ROUTES.length === 1` and the file established that the one route was Sentry's. The tripwire could never fail first.
- `dedupeKey changes when alert_cycle_key differs` — tautological for a template string interpolating that key, and another test already pinned the exact literal format.

The user also had to ask twice: once about the specific test, then a broader "are all of these worth their weight?"

**Why the skill missed it.** `angles/proportionality.md` asks whether verification effort is proportionate to what it verifies, and covers scaffolding-heavy tests and tests that only assert the language works. It never asks whether a test is _subsumed_ by a stricter assertion elsewhere.

**Proposed addition** (`references/angles/proportionality.md`, after the existing test paragraph):

> Then ask subsumption of every test the diff adds: what change to the production code would make **this** test fail first? If another test in the suite fails on every such change, this one adds nothing — a stricter assertion elsewhere (a whole-object `toEqual`, an exact-format check, a count) silently covers it. Two shapes to expect: a test asserting a weaker property than one its neighbours already pin exactly, and several tests driving one branch with different inputs, which want a single table-driven case rather than a test each. Review individual assertions too, not just whole tests — an assertion implied by a preceding structural-equality check is the same defect one level down.

This one rule would have caught all four items eventually cut from that suite: the tripwire, the tautological dedupe test, a redundant `expect('slack' in event)` following a whole-object `toEqual`, and two pairs of tests driving one branch with different inputs (missing/wrong token; object/empty required field).

### 6. Files in the diff for no reason

**What happened.** Two files whose entire contribution was churn:

- `verify.ts` — the only change was reflowing a comment across a line break, no semantic difference.
- `tsconfig.test.json` — deleted a sentence that was still true, collateral from a `node:crypto` plan the implementation abandoned. The code change got reverted; the comment edit did not.

The right action in both cases was to revert the file to base so it left the diff entirely. Nothing in either skill suggests that.

**Proposed addition** (`references/angles/simplification.md`, alongside "Dead code left behind"):

> - **Files in the diff for no reason** — a file whose whole change is a reword, a reflow, or a formatting shuffle with no semantic difference. Propose reverting it to base (`git checkout <base> -- <path>`) so it leaves the diff entirely. Look hardest at files touched by a direction the change later abandoned; the code got reverted and the comment edit didn't.

### 7. Values carried but never consumed — including the calibration

**What happened, including a wrong call.** A parsed `priority` field was consumed by nothing: the route table matched on other fields entirely. On that basis it was removed. The user restored it: _"The 9 lines for priority weren't bad restore them. There was no logic. It was just parsing."_

The analysis was right and the action was wrong, which is the part worth encoding. The carrying cost was a single `coerceStr` call and one spread entry — no branch, no validation path, no config. And the producer was a webhook template hand-configured in a third-party UI outside version control, so re-adding the field later costs more than keeping it. What actually deserved attention was the field's _misleading name_, not its existence.

**Proposed addition** (`references/angles/simplification.md`):

> - **Values carried but never consumed** — a parsed field, config key, or metadata entry nothing reads. Weigh the carrying cost before proposing removal: a field that costs a branch, a validation path, or a config knob is worth cutting, but one costing a single assignment in an otherwise-pure parse usually isn't. Removal is a bad trade when re-adding it later means changing a producer outside this repo's control — a hand-configured webhook template, a third-party payload, an operator-authored form. Flag the misleading _name_ or the absent documentation instead of the field. And don't propose adding docs or comments for a field nothing consumes; that's weight on something with no reader.

The final clause covers a second misstep in the same session: after establishing that the field was unconsumed, the next suggestion was to _document its semantics_ — adding weight to something with no reader.

---

## Considered and not proposed

- **`references/acceptable-comments.md`** needs nothing. Its field-doc rule already licensed the short `// the event's priority: "normal" or "low"` the user accepted as the replacement.
- **`strictness-high.md`'s closing line** already anticipates the "still dense" case ("when the user says a comment is 'still' dense, the previous pass under-cut"). The failure there was application, not the rule — item 2 addresses it.
- **A rule about project-management references in code comments.** Already covered: `strictness-low.md` has "Comments aren't a task tracker." The session's ticket-reference cleanup was in a README, which is out of scope here.
