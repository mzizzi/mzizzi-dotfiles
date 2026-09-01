# `--apply` argument for the fix-\* skills — Brainstorm

## The idea

The `mzizzi:fix-*` family (`fix-all`, `fix-correctness`, `fix-quality`, `fix-comments`) reviews a change and then applies only the small, local fixes, deferring anything larger to a report or to a plan's Follow-ups. There is no way to say "just fix the big ones too" — the only lever is `--dry-run`, which goes the other direction and defers everything.

The exploration started as "add a flag that lets the skills fix larger issues without deferring," passed through a boolean (`--no-defer`) and a three-level scale (`--appetite=trivial|contained|invasive`), and landed once we noticed that `--dry-run` is already a point on the same axis: it is "defer everything." Deferral size is one ordered dimension, so it should be one argument, not two flags that interact.

The result is an optional `--apply`, replacing `--dry-run`:

| value | behavior | replaces |
| --- | --- | --- |
| `none` | review and report, change nothing | `--dry-run` |
| _(omitted)_ | apply what the skill already considers small and local, defer the rest | today's default |
| `all` | apply everything valid, defer nothing | the new capability |

Two flags with four combinations — one nonsensical, needing a written precedence rule — become one optional flag with two values and no interactions to specify.

## Decisions

### Sequencing against the shared-target-resolver proposal

- **Question:** `plans/20260809-shared-target-resolver-for-fix-skills/proposal.md` is seeded but unimplemented and rewrites the same step-1 argument prose. Land `--apply` now, fold it into that work, or wait for it?
- **Decision:** Land `--apply` now, independently.
- **Why:** That proposal explicitly scopes mode out of the resolver — "Mode and judgment. `--dry-run`, triage, apply-vs-defer, verification — all stay in each skill" (checked, proposal.md). The two changes therefore edit disjoint parts of step 1: the resolver replaces target tokens, `--apply` replaces mode. Its only collision is one forward-looking line predicting "Mode determination reduces to just `--dry-run`", which becomes a one-word update. Waiting would gate prose edits in four files behind a new skill, a new shell script, and a `run_review.mjs` change that has not been started (checked: no `resolve-fix-target` on disk, one commit in that plan dir). The tradeoff declined: a single combined vocabulary change, at the price of shipping nothing until the resolver is done.

### The default has no name

- **Question:** `fix-correctness` has two size buckets and applies only `trivial`; `fix-quality` has three and applies `trivial` + `contained` (both checked in their step 4 / step 6 text). What does a middle value mean across that mismatch?
- **Decision:** There is no middle value. `--apply` is optional with values `none` and `all`; omitting it means each skill's existing threshold, unchanged.
- **Why:** Naming the middle was what created the problem. A uniform "trivial only" would silently narrow `fix-quality`; a uniform "trivial + contained" would silently widen `fix-correctness`, the riskier pass. Per-skill definitions avoided both but made `--apply=trivial` select trivial _plus contained_ in one skill — a name contradicting its own behavior, plus a carve-out noting that `fix-comments` can't tell the two apart. Leaving the default unnamed deletes all of it: nothing observable changes, since a user wanting today's behavior omits the flag exactly as they do now. Raised by the pragmatic review, which caught the contradiction the earlier per-skill framing had papered over.

### Value names

- **Question:** `none|all`, or the initially floated `dry-run|aggressive`?
- **Decision:** `none|all`.
- **Why:** `dry-run` is a mode name sitting among size names, so `--apply=dry-run` reads as a category error against its sibling; `none`/`all` reads as one scale answering "how much do you apply." `aggressive` was rejected as misleading — it sounds like the bar drops, when the only thing that changes is the size ceiling. Cost accepted: the familiar `--dry-run` string stops working.

### No `--dry-run` alias, and no rule about it

- **Question:** Keep `--dry-run` as an alias for `--apply=none` during a transition, or specify that it must produce a usage error?
- **Decision:** Neither. Remove it from the docs and say nothing about it.
- **Why:** An alias re-adds the second flag whose removal is the point of the change. But requiring a usage error is the same mistake in reverse — it keeps the removed flag documented in all four files, the identical per-file footprint, for a worse outcome. Both natural results are fine: the model maps `--dry-run` to read-only, or flags it as unrecognized. The resolver proposal reached the same hard-cutover call for its own vocabulary break — "these are personal skills with one user; a compatibility shim outlives its usefulness the day it's written" (checked, proposal.md open questions). Cost: muscle memory.

### No confirmation gate before `--apply=all`

- **Question:** Should `fix-all` confirm before running three passes at `all`, since that is three rounds of invasive edits before the user sees anything?
- **Decision:** No gate.
- **Why:** Nothing observable breaks without one. Verification already runs at the end of each pass, and a fix that fails it is reverted and moved to Deferred with the failure noted — unchanged at every `--apply` value. Cheap to add the first time a run goes badly.

### `all` raises the ceiling, never the bar — said once

- **Question:** How much does the skill text need to spell out about what `all` does _not_ change (validity filter, `fix-quality`'s behavior-preserving drop criteria, revert-on-verification-failure, `AskUserQuestion` on a genuine scope call)?
- **Decision:** One clause where `all` is defined: it raises the size ceiling, never the bar. Don't enumerate the invariants.
- **Why:** All four are already fully specified in the existing steps, so listing them again is documentation duplicating its source — the repo's own single-source-of-truth rule. The framing is the part that does functional work in prompt-interpreted prose; the enumeration is restatement.

### Keeping the feature at all

- **Question:** The review argued `--apply=all` may be unnecessary, since a free-text instruction at invocation ("also apply the invasive ones") could already override the default — leaving only a rename of `--dry-run`.
- **Decision:** Keep it.
- **Why:** YAGNI tests machinery nobody asked for; this was the session's opening request, so the need is stated rather than speculative. Every other mode in this family already lives on an argument — `--plan`, `--strictness`, `--dry-run` — so leaving this one to free text would make it the odd one out, unverifiable per run, and arguing against the step-4 / step-6 prose that instructs the model to defer. The rename half is not churn either: it collapses two interacting flags onto one axis, removing combinations that exist today. Not checked: whether free-text override actually works reliably. Declined to measure it, since the convention answers the question regardless of the result.

### Scope of the edit

- **Question:** What actually has to change?
- **Decision:** The `argument-hint` line and the mode prose in four `SKILL.md` files. Nothing else.
- **Why:** Checked repo-wide: nothing outside the fix-\* family references `--dry-run` except the resolver proposal's one forward-looking line. `implement-plan` invokes `fix-all local --plan <path> --strictness=high` (implement-plan/SKILL.md:72) and passes no mode flag, so it is unaffected.

### Forced read-only cases carry over verbatim

- **Question:** `fix-quality` and `fix-comments` pin a run to read-only when a PR target isn't checked out. Rework that now?
- **Decision:** No — carry today's behavior unchanged, reading as "forced to `none`."
- **Why:** It is a fallback, not a flag interaction, so it costs nothing to leave alone. The resolver proposal already plans to delete the whole branch — the `headRefOid` check and the "PR not checked out → skip apply" logic — when PR targets go away, so reworking it here would be work thrown away twice.
