# Parallel review in implement-plan — Brainstorm

## The idea

`/mzizzi:implement-plan` currently runs a single cross-model review of the code it just
wrote: Step 4 calls `mzizzi:codex-adversarial-review`, and Step 5 triages what comes back.
One engine, one lens. The idea is to widen that step into a **parallel review** — run the
Codex adversarial review alongside Claude Code's built-in `/code-review`, then triage the
combined findings.

The fact that makes this possible: `code-review` ships with `disable-model-invocation: true`,
so a skill cannot call it — but that gate blocks *the model*, not the CLI. Running
`claude -p "/code-review"` makes it user input in a separate process, where it executes
normally. This is the same class of gate `mzizzi:codex-adversarial-review` already exists to
work around, with a different bypass. The design therefore lands in the shape originally
sketched:

```
parallel-review
  ├─ in parallel
  │    ├─ Codex adversarial review
  │    └─ built-in code-review (headless subprocess)
  └─ combine findings, report back to caller
```

## Decisions

### The Claude-side reviewer is the real built-in, not a hand-rolled substitute

- **Question:** `/code-review` can't be invoked by the model. What plays the Claude-side
  reviewer role — a bespoke reviewer subagent, a hand-off to the user, or the genuine
  built-in?
- **Decision:** The genuine built-in, run in its usual form, fan-out and all.
- **Why:** `--bare`'s own help text states that "skills still resolve via `/skill-name`" in
  headless mode, so a slash command typed into `claude -p` is user input and the
  `disable-model-invocation` gate does not apply. A hand-rolled reviewer would only
  approximate something that can be invoked directly.

### Complementary lenses, not the same lens twice

- **Question:** Do both engines review for the same things, or split the ground?
- **Decision:** Codex challenges implementation approach and design choices plus plan
  fidelity; the built-in does its own fixed sweep (CLAUDE.md adherence, bugs, git history
  context, comment guidance).
- **Why:** Each engine works its strength rather than both grinding the same ground, and
  triage sees fewer duplicate findings. The codex plugin describes its review as challenging
  "the implementation approach and design choices," and it is the arm that reads the plan
  document — so plan fidelity naturally belongs to it.

### A new reusable skill, not inline in Step 4

- **Question:** Does the parallel-review machinery live inside `implement-plan`'s Step 4, or
  become its own skill?
- **Decision:** A new `mzizzi:parallel-review` skill. Step 4 shrinks to a one-line call.
- **Why:** `implement-plan` already delegates every reusable piece to a skill
  (`codex-adversarial-review` in Step 4, `review-comments` in Step 8), and
  `codex-adversarial-review` is already shared with `create-plan`. Inlining would make Step 4
  the longest step in the skill and leave the capability unreachable from anywhere else.
  Extracting also yields `/mzizzi:parallel-review` as a standalone command for any working
  diff.

### Named `parallel-review`

- **Question:** What to call it — `parallel-review`, `parallel-code-review`, or `cross-review`?
- **Decision:** `parallel-review`.
- **Why:** Matches how the idea was described, sits cleanly beside `codex-adversarial-review`
  and `review-comments`, and doesn't bake "exactly two engines" into the name if a third arm
  is ever added.

### Both arms are bash calls issued together

- **Question:** How are the two reviewers actually run concurrently, given they have
  different shapes?
- **Decision:** Both arms are foreground `Bash` calls emitted in a single message — the Codex
  script and `claude -p`.
- **Why:** Independent tool calls in one message run in parallel, and the headless review is
  a separate OS process, so the two genuinely overlap rather than time-slicing the main loop.
  This also means no subagent hop sits between either report and triage, so nothing gets
  summarized on the way through.

### The built-in runs as a headless subprocess with Opus at high effort

- **Question:** Spawn the built-in via `claude -p`, or vendor its prompt text out of the CLI
  binary into a model-invocable skill?
- **Decision:** Spawn it: `claude -p "/code-review"` from the repo root, with `--model opus`
  and high effort.
- **Why:** It's the real thing, fanning out exactly as it normally does, and it stays current
  as Claude Code updates — a vendored copy is a frozen snapshot that drifts silently and
  can't use `ReportFindings` the way the real one does. Structurally this mirrors what
  `codex-adversarial-review` already does: shell out to something that does the real work.
  *(The exact spelling of the effort flag in headless mode was not verified — see Open
  questions.)*

### Findings come back via stream-json, extracted with jq

- **Question:** How does the skill capture findings out of the headless run — plain text, or
  structured output?
- **Decision:** `--output-format stream-json`, with `jq` pulling the `ReportFindings`
  tool-call input out of the stream.
- **Why:** `ReportFindings` exists precisely because findings are rendered by the host UI, so
  a headless run's final text may collapse to a summary and lose the detail triage needs.
  The tool-call input carries the typed findings verbatim — file, line, category, summary,
  failure scenario, CONFIRMED/PLAUSIBLE verdict.

### The subprocess gets a read-only tool allowlist

- **Question:** How is the headless run permissioned, given it can't answer prompts?
- **Decision:** `--allowedTools` scoped to what a review needs (read, search, read-only git,
  subagent spawning) — nothing that writes. Not `bypassPermissions`.
- **Why:** `implement-plan` calls this with the entire implementation sitting **uncommitted**
  in the working tree. An unattended process with edit rights could mutate the very diff it's
  reviewing, with no record that it happened. A review has no business writing files, so
  least privilege costs nothing here and closes a real hazard.

### The Codex arm goes through the existing skill, not straight to the script

- **Question:** Does `parallel-review` call `run_review.sh` directly, or `Skill()` into
  `codex-adversarial-review`?
- **Decision:** `Skill()` into `codex-adversarial-review`.
- **Why:** That SKILL.md owns the Codex contract — script path, exit-code meanings, result
  shape — and three callers (`create-plan`, `implement-plan`, `parallel-review`) now depend
  on it; one owner means one file to update. The extra `Skill()` turn costs a round-trip but
  not parallelism: `Skill()` only loads instructions, and both bash calls still go out
  together in the following message.

### Focus text routes to the Codex arm only

- **Question:** `implement-plan` passes focus text naming the plan document. Does that reach
  both arms?
- **Decision:** Codex only. The built-in runs bare against the working diff.
- **Why:** The built-in's argument slot selects a *target*, not a lens, so free text there is
  unverified behavior. Running it bare is what "in its usual form" means. This does mean
  plan-fidelity coverage rides entirely on the Codex arm — accepted knowingly.

### Working diff only; PR review is out of scope

- **Question:** Does the skill support reviewing a PR as well as the working diff?
- **Decision:** Working diff only. PR review deferred.
- **Why:** The two engines don't share a target vocabulary. The Codex arm has no PR concept
  at all (`codex-companion.mjs` takes `--scope auto|working-tree|branch` and `--base <ref>`,
  all git-ref based) while the built-in takes a PR number. Bridging them
  means `gh` translation plus a guard that the PR's head branch is the current checkout,
  otherwise the two arms review different diffs and the merged list silently mixes them.
  That's scope creep against a target `implement-plan` never needs.

### One arm failing degrades rather than aborts

- **Question:** What happens when Codex is unauthenticated, or the subprocess errors or
  times out?
- **Decision:** Report the surviving arm's findings, name the failed arm and its reason, and
  only report "review unavailable" when both fail.
- **Why:** Redundancy is the main thing two engines buy; throwing away a review that ran
  because the other engine wasn't authenticated wastes it. `implement-plan`'s existing
  "review unavailable → skip to Step 8" branch narrows to "both arms failed."

### The skill returns one merged list with provenance

- **Question:** Merge the two reports, or pass both through side by side?
- **Decision:** One normalized list, deduped by file/line plus claim, each entry tagged with
  which engine raised it (codex / code-review / both). Raw Codex report and raw findings JSON
  appended below so triage can drill into anything normalization flattened.
- **Why:** "Both engines independently flagged this" is the most useful triage signal
  available and it's free here. Side-by-side output would make every caller redo the dedup
  and force Step 5 to reconcile two formats each round.

### Agreement is evidence, not a promotion rule

- **Question:** Does cross-engine agreement mechanically change how Step 5 triages a finding?
- **Decision:** No rule. Step 5 keeps its existing three judgments (valid/noise,
  fix-now/defer, trivial/needs-thought) and treats agreement as strong evidence on the
  valid/noise call.
- **Why:** A hard promotion rule lets a blind spot the two models *share* bypass judgment
  entirely. It also inverts the point of adding a second engine: the findings only one arm
  raised are often the most valuable, precisely because the other missed them.

### Always on, with no opt-out flag

- **Question:** Should `implement-plan` offer a way to skip the second arm on cheap rounds?
- **Decision:** Always run both. No flag.
- **Why:** `implement-plan`'s Step 0 exists specifically to protect the review tail —
  "finishing the code doesn't end the run." A skip flag is an invitation to skip exactly the
  step the skill was built to defend, and it would quietly revert to today's single-engine
  review. The marginal cost of one headless session is small next to the implementation round
  that preceded it.

### Reports stay in the conversation

- **Question:** Do the raw reports get written to disk?
- **Decision:** No. The skill returns the merged list plus raw output; nothing is persisted.
- **Why:** `implement-plan` already has the durable channel that matters — Step 7 folds valid
  deferred findings into the plan's `## Follow-ups`, next to what a reviewer is already
  reading. A parallel file of raw review output duplicates that, rots as the code changes,
  and `parallel-review` can't assume a plan directory exists when run standalone.

## Open questions

- **The effort flag's exact spelling in headless mode** was not verified. `settings.json`
  already sets `effort: high` and a subprocess loads user settings by default, so the
  intended behavior may come for free — but the explicit flag (if one exists) should be
  confirmed at build time rather than guessed.
- **Whether `--model opus` reaches the built-in's internal fan-out.** `--model` sets the
  session model; `/code-review` spawns its own tiers internally and may pick them itself, in
  which case the override only affects the orchestrator.
- **PR review as a target** — deliberately deferred (see above), to revisit later.
- **`codex-adversarial-review`'s SKILL.md is written for a serial caller** ("the call must
  complete before you have a result to act on"). It needs a line acknowledging that
  concurrent use alongside another reviewer is expected, so that sentence isn't read as
  "never issue it alongside another call."
