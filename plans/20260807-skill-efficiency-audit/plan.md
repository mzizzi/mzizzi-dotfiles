# Skill efficiency audit — top issues and fixes

**Window:** 2026-07-24 → 2026-08-07. **Corpus:** 430 sessions (~250 MB of transcripts) across SimRacing, telemetry-viewer, triples-comparisons, worktree projects, and this repo; 357 sessions invoked at least one skill. Nine analyst sub-agents (mzizzi:standard/simple) mined the transcripts by skill family; two mzizzi:complex agents designed solutions with a hard bias toward deleting prompts/machinery rather than adding more.

**The audit's central lesson:** corrective prompt text does not change behavior here. The clearest case: the "decide code-shape forks yourself" rule was written in three places (auto-memory, grill/SKILL.md, recommendation-guidelines.md) and the failure recurred after each — including in both sessions post-dating the latest fix. Every fix below therefore deletes text, deletes machinery, or moves a decision into code — no fix here asks the model to behave differently in prose.

---

## 1. fix-quality: size-gate the fan-out, route angles to `simple`, delete the efficiency angle

**Issue.** The fix chain dominates spend: in 28 chain sessions, subagent fan-out alone was 43.7% of all billable tokens (everything after the first `fix-*`: 81.7%). Worst case: 201K tokens to build a nine-file display-string change, 943K across five Opus angle agents reviewing it — 88% of the session spent on review that yielded one rename, one ternary flatten, and four comment tweaks. No size floor exists; all five angles run on any diff. The efficiency angle returned zero proposals in 47% of runs at 184K tokens per proposal (2.4–3.6× any other angle; 6.6M Opus tokens in two weeks). Meanwhile the tier ladder is inverted: `simple` is documented as the default and no plugin skill routes to it — fix-quality's hardcoded `mzizzi:standard` alone is ~101 of 130 standard spawns. And 32% of runs already skip the fan-out by stretching the "Agent tool isn't available" fallback.

**Fix.**

- **(a) Size-gate the fan-out.** Step 3 gains a gate: a diff small enough to read whole gets a single-pass review of all angles, no agents — which sanctions what a third of runs already do by stretching the availability fallback.
- **(b) Delete the step-4 availability fallback.** With (a) in place its only remaining use is the pretext runs currently use to skip the fan-out.
- **(c) Route angle agents to `simple`.** Step 4's `mzizzi:standard` → `mzizzi:simple`: angle work is bounded scanning against a written spec, with the Opus parent already filtering, deduping, and applying.
- **(d) Delete the efficiency angle.** Remove `references/angles/efficiency.md` and hoist its three durable bullets into `simplification.md`.

Expected: conservatively half of the 37.3M subagent tokens per two weeks.

## 3. grill: invert the interview default — decide and narrate; ask only user-observable forks; a bounce is an answer

**Issue.** The "Every single question should use the AskUserQuestion tool / interview me relentlessly" mandate produces a 33% decline rate corpus-wide (205 of 621 calls; worst session 73%). Declines are consistently the meta-move the skill forbids: "explain the tradeoffs", "draw a diagram", "your call — KISS/YAGNI". 24% of all question calls re-ask a question already asked (a bounce gets reformulated instead of absorbed). 75% of answered questions rubber-stamp the first (Recommended) option — the recommendation is the product; the menu is ceremony. Median interview: 41 minutes; worst: 2h03. Three rounds of corrective bullets did not move any of these numbers.

**Fix.** Rewrite `grill/SKILL.md` at roughly half its current 629 words. Deleting the mandate is the only move not yet tried, and it is net-negative text.

- **(a) Delete the ask-everything mandate**, the 130-word code-shape bullet, and the meta-options ban. These are the three rules the decline rate is measuring.
- **(b) Invert the default.** Research each fork and state the call in a sentence with its reason; reserve AskUserQuestion for forks with user-observable outcomes where research left the call genuinely uncertain.
- **(c) Keep the research by keeping the decision log.** Stated calls still land in brainstorm.md, which create-plan verifiably consumes — what's lost is the asking, not the thinking.
- **(d) Replace all bounce-handling with one structural sentence.** A reply that isn't an option pick is the interview working: answer it in prose, then state or ask the fork it informed, and never re-issue an asked question.
- **(e) Dedup what survives.** Delete the now-redundant auto-memories (`feedback_decide_with_kiss_yagni`, `feedback_define_jargon_in_questions`) and the overlapping §KISS restatement, so each rule exists in exactly one place.

---

## Guardrails — verified working; do not cut

The analysts explicitly checked these and found them healthy: the three-pass fix structure (87–90% code-line survival per pass; the churn was comments, not code); fix-correctness itself (cheapest, cleanest pass); brainstorm.md consumption by create-plan (emphatic handoffs, sub-agents verifiably read it first); brainstorm's exit loop (the drag is the interview, not the loop); the codex review loop's convergence and its blocking-call/parallel-reviewer discipline; one-task-per-phase seeding and the fix-all routing in implement-plan (100% compliance); `create_plan_dir.sh` on Windows (39/39 clean); worktree _reuse_ logic. Also deliberate no-actions: `record-follow-ups` (9 days old, designed for months-later pickup — re-measure before wiring a consumer), `monitor-research` (2 days old), `parallel-review` (never shipped; its dead end is already documented in the 20260725 plan's follow-ups), and the `complex` tier (one use in two weeks is what "reserved" looks like).

## Below the cut

Smaller fixes that didn't make the list, recorded as one-liners so they aren't re-derived: `run_review.mjs --files` rejects a deleted path, since it requires every target to exist in the working tree — a staged deletion is a legitimate review target, and supporting it means falling back to the index or HEAD for contents; fix-comments' own second pass rewords more than it cuts (807 lines written per 1441 deleted, comments re-reworded 2–3×, one round-tripping back to its original text) — constrain the re-read so deletion is the only permitted action, which is structural and unrelated to the upstream passes' unstoppable narration; a PostToolUse prettier hook for skill-written markdown (17 sessions paid a commit-retry; deterministic formatting belongs in a script, not three skills' prose); fix-all's third verification run has never added information (make it conditional on fix-comments applying changes); implement-plan should state the resolved plan path as its first line of output (6 of 8 kills landed blind in the preamble); `TMPDIR` export for Git Bash and `git config core.longpaths true` (deterministic Windows breakage no prompt can fix); anti-slop-writing's mandatory four-file pass is disproportionate for the technical docs it's actually used on; one pragmatic review per brainstorm document (second passes on the same document found nothing).

## Method note

Analyst evidence lives in the session transcripts under `~/.claude/projects/` (session IDs cited throughout the per-family findings). The full findings and both solution reports were working artifacts in the session scratchpad; this document is the durable record.
