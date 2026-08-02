# claude-powerline: cache-creation tokens always priced at the 5-minute rate

Verified 2026-07-31 against `@owloops/claude-powerline` **v1.29.0** (latest published; npm `latest` = 1.29.0, published 2026-07-28) **and against `origin/main` at `82de76a`** — the 1.29.0 release commit, with no commits beyond it. The bug is present in both, identically.

`ModelPricing.cache_write_1h` is declared and populated everywhere but read nowhere. `calculateCostForEntry` prices all cache-creation tokens at `cache_write_5m`, so every 1-hour-TTL cache write is billed in the statusline at 1.25x the model's input rate when the real rate is 2x. Measured over a month of local transcripts, this under-reports total cost by **7.14%**.

**There is no durable local workaround.** The documented statusline invocation is `npx -y @owloops/claude-powerline@latest`, so a patched copy in the npx cache is discarded on the next resolve. Short of maintaining a fork, upstreaming is the only way to get a correct number.

---

## Root cause

`ModelPricing` declares `cache_write_1h` (`src/segments/pricing.ts:10`), and every model in the bundled offline table, the hardcoded fallback (`pricing.ts:396`), and the synced `pricing.json` populates it. Nothing consumes it. `calculateCostForEntry` (`pricing.ts:404`) unconditionally applies the 5-minute rate:

```ts
const cacheCreationTokens = usage.cache_creation_input_tokens || 0;
...
const cacheCreationCost =
  (cacheCreationTokens / 1_000_000) * pricing.cache_write_5m;   // pricing.ts:424-425
```

Confirmed dead by grepping `src/` for `cache_write_1h` outside of `cache_write_1h: <value>` assignments — zero hits. A neat corroboration: `grep -c cache_write_5m` returns exactly one more line than `grep -c cache_write_1h`, and that one extra line is the calculation above. The same holds in the shipped `dist/index.mjs`, where `cache_write_1h` appears only inside data literals.

The transcript carries the split that the pricing path ignores. Assistant entries record:

```jsonc
"usage": {
  "cache_creation_input_tokens": 11299,
  "cache_creation": {
    "ephemeral_5m_input_tokens": 0,
    "ephemeral_1h_input_tokens": 11299
  }
}
```

`calculateCostForEntry` reads only the flat field, which collapses the two buckets.

### The buggy path always runs

Two mechanisms could in principle bypass `calculateCostForEntry`. Neither does.

**The `costUSD` shortcut never fires.** `session.ts:101` and `today.ts:107` skip the pricing calculation entirely when a transcript entry carries a precomputed `costUSD`. Across 59,640 assistant entries in the sample below, **zero** carry that field — Claude Code does not emit it — so every entry falls through to `calculateCostForEntry`.

**The official hook cost is dead code.** `session.ts:164` reads:

```ts
const calculatedCost = sessionUsage.totalCost;
const hookDataCost = hookData?.cost?.total_cost_usd ?? null;
const cost = calculatedCost ?? hookDataCost;
```

`totalCost` is initialized to `0` and accumulated, so it is always a number and never nullish. `hookDataCost` — Claude Code's own `total_cost_usd` from the hook payload — is therefore unreachable. The session segment always displays powerline's own computed figure in preference to the authoritative one, which is part of why the discrepancy is easy to miss.

### The rate gap is uniform

Across every model in the synced pricing table, without exception:

| bucket           | rate        |
| ---------------- | ----------- |
| `cache_write_5m` | 1.25x input |
| `cache_write_1h` | 2.0x input  |

So a mispriced 1h write is always under-charged by exactly 37.5%, regardless of model.

These multipliers are confirmed against Anthropic's published prompt-caching documentation (cache writes 1.25x base input at 5-minute TTL, 2x at 1-hour; reads ~0.1x), not just against powerline's own table. That matters because `pricing.json` is generated from LiteLLM — had the values only been checked against themselves, the cost figures below would be circular.

---

## Evidence

### Method

All `*.jsonl` under `~/.claude/projects/`, spanning **2026-06-29 to 2026-07-31**. Assistant entries carrying a `usage` object, deduplicated using powerline's own semantics: the key is `` `${messageId}:${requestId}` `` (`createUniqueHash`, `utils/claude.ts:311-325`), and entries missing either field produce a null hash and are **kept** rather than collapsed (`loadEntriesFromProjects`, `claude.ts:531-541`) — 11 such entries exist. That yields **26,690 entries**, of which 18 are `<synthetic>` with no real token usage and are excluded from pricing.

**The reconstruction is validated end to end.** Running powerline itself against the same transcripts, its `today` segment reported $10.58 at 12,026,896 tokens while this model predicted $11.00 at 12,469,627 — the gap is drift from the live session growing between the two measurements. Normalizing to cost per million tokens, which cancels the drift: **$0.8797 actual vs $0.8821 predicted, a 0.27% deviation.** The residual is the differing token mix in the ~440K tokens of drift.

Cost computed two ways per entry, using powerline's own synced `pricing.json` rates:

- **correct** — `5m_tokens x cache_write_5m + 1h_tokens x cache_write_1h`
- **powerline** — `cache_creation_input_tokens x cache_write_5m`

Input, output, and cache-read costs are identical under both and are included in the totals, so the percentage below is the error in _total reported cost_, not in the cache-write line alone.

### The TTL split

| bucket         | tokens     | share     |
| -------------- | ---------- | --------- |
| `ephemeral_1h` | 68,544,250 | **75.3%** |
| `ephemeral_5m` | 22,483,588 | 24.7%     |

Every one of the 26,690 deduped entries carried the `cache_creation` breakdown object. None were missing it.

Per model, the 1h share varies widely (hashed entries only, so the 1h column totals slightly below the figure above):

| model                       | 5m tokens  | 1h tokens  | 1h share |
| --------------------------- | ---------- | ---------- | -------- |
| `claude-fable-5`            | 74,425     | 6,146,067  | 98.8%    |
| `claude-opus-4-8`           | 4,191,943  | 29,470,974 | 87.5%    |
| `claude-sonnet-5`           | 4,525,732  | 10,703,400 | 70.3%    |
| `claude-opus-5`             | 12,768,604 | 22,123,903 | 63.4%    |
| `claude-haiku-4-5-20251001` | 922,884    | 35,671     | 3.7%     |

Haiku is the outlier — it is used for short background tasks that take the 5m cache and is priced almost correctly today. The long-context models, which dominate spend, are majority 1h.

### Cost impact

|                            | cost                |
| -------------------------- | ------------------- |
| correct (per-bucket rates) | **$3,585.32**       |
| powerline (flat 5m rate)   | **$3,329.42**       |
| under-reported             | **$255.90 — 7.14%** |

Per-day error ranges from roughly 6.7% to 15.8% depending on the day's model and cache mix. The error scales with 1h cache-write volume, so cache-heavy long-context sessions are hit hardest, and it is always in the same direction: powerline under-reports, never over-reports.

**What the dollar figure is and isn't.** Powerline derives cost from token counts times published list prices. On a Claude subscription the resulting number is an estimate, not an invoice — no bill changes when it is wrong. The value of fixing it is accurate _relative_ signal (which sessions are expensive, how cache-heavy work compares), and correctness for anyone actually billed at API rates. Worth stating plainly so the 7% is not oversold.

### An apparent anomaly that turned out to be unrelated

One entry of 26,690 appears to have a flat field disagreeing with its breakdown (`cache_creation_input_tokens=0` alongside `ephemeral_1h_input_tokens=764`). It is **not** an API quirk, and it is not evidence for anything in this report.

The same `messageId:requestId` appears in two different transcript files with different payloads. One copy is fully populated (`input=2`, `output=584`, `cache_read=339924`, `cache_creation=764`). The other has every top-level counter zeroed while retaining the nested `cache_creation` object and an `iterations` array carrying the real numbers. Which copy survives deduplication depends on file ordering.

Two consequences. First, **do not cite this as a fixture rationale** — the flat field and the breakdown do not disagree in any entry the API actually emitted. Second, it hints at a separate latent bug: if powerline keeps the zeroed copy, it under-counts input, output, and cache-read tokens for that entry as well. That is a Claude Code transcript-duplication artifact rather than a powerline pricing defect, and it is out of scope here — mention it only if a maintainer asks about the entry.

---

## Proposed fix

In `calculateCostForEntry`, read the breakdown and apply each rate to its own bucket, falling back to the flat field only when the breakdown is absent (older transcripts, and any provider that does not emit it):

```ts
const cacheCreation = usage.cache_creation as
  | { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
  | undefined;

const cw5m = cacheCreation?.ephemeral_5m_input_tokens ?? 0;
const cw1h = cacheCreation?.ephemeral_1h_input_tokens ?? 0;

// Fall back to the flat field when no breakdown is present, preserving today's behavior.
const cacheCreationCost = cacheCreation
  ? (cw5m / 1_000_000) * pricing.cache_write_5m +
    (cw1h / 1_000_000) * pricing.cache_write_1h
  : ((usage.cache_creation_input_tokens || 0) / 1_000_000) * pricing.cache_write_5m;
```

`usage` is typed `Record<string, number>` at `pricing.ts:408`, which will not accommodate the nested object — that type needs widening as part of the change.

### Test fixtures

- breakdown present, both buckets non-zero — each priced at its own rate
- breakdown present, only `ephemeral_1h` non-zero — the common case; priced at 2x input
- breakdown present but both buckets zero — no cache-write cost
- breakdown absent entirely — falls back to the flat field at the 5m rate, matching current behavior

`PricingService` has **no test coverage today** — grepping `test/` for `calculateCostForEntry` or `PricingService` returns nothing. These would be the first. Keep them minimal and match the conventions already in `test/segments.test.ts`; a maintainer is likelier to merge a small diff than a small diff plus a new testing pattern they did not ask for.

### Open question for the maintainer

**Is the flat-field fallback live code or dead code?** The sample above cannot answer it: it begins 2026-06-29, every entry in it carries the breakdown, and it contains no Bedrock or Vertex model IDs. If `cache_creation` predates every Claude Code version still in use and no supported provider omits it, the fallback is unreachable and the maintainer may prefer it dropped. Raise this as a question in the PR description rather than asserting either way.

---

## Related: the same field is already parsed elsewhere

`cacheTimer` already does the right thing. `detectTtlSeconds` (`src/segments/cacheTimer.ts:80`) walks the transcript backwards and returns `3600` when it sees `cache_creation.ephemeral_1h_input_tokens > 0`, else `300` for the 5m bucket, and feeds that into the segment's TTL.

So the codebase already accepts that 1-hour caches exist and already parses the exact field the pricing path ignores. This is the strongest framing for the issue: not a new claim about cache TTLs that a maintainer has to be convinced of, but an internal inconsistency between two segments reading the same transcript.

(An earlier draft of this report cited issue #81's fixed 3m/4m/5m `cacheTimer` thresholds as evidence of a repo-wide 5-minute assumption. That is now stale — the TTL detection above supersedes it. Do not raise it.)

---

## Upstream state

Re-verified **2026-07-31**. `origin/main` is at `82de76a` (the 1.29.0 release) with no commits beyond it; `git show origin/main:src/segments/pricing.ts` carries the defect at line 425 with the same grep asymmetry described above. Nothing has been fixed and nothing is in flight.

No existing issue or PR covers this. Confirmed by listing all issues and PRs (open and closed) and filtering titles for cache/pricing/TTL/ephemeral terms — zero relevant hits. Nearest neighbours:

- **#98** (now **closed**) — "Session cost shows higher than daily cost (logically impossible)". Transcript-file cache invalidation, not token pricing. Fixed by PR #99, merged. Different bug. _(An earlier draft of this report listed #98 as open; it has since closed.)_
- **#71** (closed, labeled `bug`) — "Add Claude Opus 4.6 and Sonnet 4.6 to pricing table". Precedent that pricing gaps are treated as legitimate bugs.
- **#81** (closed) — the `cacheTimer` segment.
- **#27** (closed) — "Accounting does not keep track of tokens/costs used by subagents". Adjacent accounting concern, different mechanism.

The only open PR is **#101** — `fix(tui): accept git.worktree in grid cells`. Unrelated.

**Contribution mechanics.** No `CONTRIBUTING.md` and no PR template. Jest, tests under `test/`, Node `>=18`. Scripts: `lint` (eslint), `typecheck` (tsc --noEmit), `test` (jest), `build` (tsdown). `prepublishOnly` runs lint + typecheck + build, so keep all three green.

**Maintainer activity.** 1,139 stars, 82 forks, but effectively a one-to-two person project. Original maintainer `pgagnidze` last committed 2026-04-20 and last merged 2026-05-25; `FallDownTheSystem` has handled merges since. Human commits in the preceding 90 days: 8, against 17 automated. Outside PRs do land, with latency from 8 days to 6 weeks.

Implication: an issue alone may sit. A PR with the fix attached is the reliable path.

---

## Draft issue text

> **Title:** Cache-creation tokens always priced at the 5-minute rate, ignoring the 1h TTL
>
> `ModelPricing.cache_write_1h` is declared and populated for every model in both the bundled table and the synced `pricing.json`, but no code path reads it — `calculateCostForEntry` always multiplies cache-creation tokens by `cache_write_5m`.
>
> Transcripts record the TTL split under `usage.cache_creation.ephemeral_1h_input_tokens` / `ephemeral_5m_input_tokens`, alongside the flat `cache_creation_input_tokens` the pricing code reads. The `cacheTimer` segment already parses exactly this field — `detectTtlSeconds` returns 3600 when `ephemeral_1h_input_tokens > 0` — so the two segments currently disagree about whether 1-hour caches exist.
>
> Across a month of local transcripts (26,690 deduped assistant entries, 2026-06-29 to 2026-07-31), 75.3% of cache-creation tokens were `ephemeral_1h`. Since `cache_write_1h` is 2x input and `cache_write_5m` is 1.25x for every model in the table, each of those tokens is under-charged by 37.5%. Recomputing total cost with per-bucket rates gives $3,585.32 against powerline's $3,329.42 — **7.14% under-reported**. The error scales with 1h cache-write volume and is always in the same direction.
>
> Worth noting the calculation is never bypassed in practice: the `costUSD` shortcut in `session.ts` / `today.ts` never fires (Claude Code doesn't emit that field), and the `calculatedCost ?? hookDataCost` fallback in `session.ts` can't reach `hookDataCost` because `totalCost` is always a number. So the session segment always shows the computed figure in preference to the hook's `total_cost_usd`.
>
> Fix: read the `cache_creation` breakdown and apply `cache_write_5m` / `cache_write_1h` to their respective buckets, falling back to the flat `cache_creation_input_tokens` field with current behavior when no breakdown is present.

## Notes for the PR

- Widen the `usage` type at `src/segments/pricing.ts:408` to allow the nested `cache_creation` object.
- Keep the flat-field fallback so older transcripts and non-Anthropic providers do not regress, and ask the open question above rather than asserting it is needed.
- Cover the fixtures listed above. These are the first tests for `PricingService`.
- Lead with the `cacheTimer` inconsistency — it makes the fix a consistency argument rather than a claim the maintainer has to independently verify.
- Do not claim cache writes are universally 1h. They are not (Haiku is 96% 5m), and the claim is trivially falsifiable without being load-bearing for the fix.
- Do not cite the duplicate-entry anomaly as evidence; it is a transcript artifact, not an API behaviour.
- Keep the diff small. Resist bundling the `cacheTimer` thresholds, the missing Opus 5 entry in the bundled offline table, or the duplicate-entry under-counting — mention them as asides at most and let the maintainer decide.

---

## Appendix: resolved sibling issue (do not file)

While chasing inflated Opus 5 costs, a second defect surfaced that has since resolved itself. Recorded here so the investigation is not repeated.

`claude-opus-5` had no pricing entry, so `fuzzyMatchModel` fell through to the generic `"opus"` catch-all and priced it as `claude-opus-4-20250514` — $15/$75 in/out, exactly 3x Opus 5's real rates. This was a data-sync timing gap, not a code defect: `pricing.json` is regenerated weekly from LiteLLM by `.github/workflows/pricing.yml`, and LiteLLM only added Opus 5 on 2026-07-24. The synced table now carries `claude-opus-5` at $5/$25 with `cache_write_5m` 6.25 / `cache_write_1h` 10 / `cache_read` 0.5, all correct, along with `claude-fable-5` and `claude-sonnet-5`.

One residual caveat: the **bundled offline table in `pricing.ts` still has no Opus 5 entry**, so a fresh install with no network would misprice it 3x until the first successful sync. Minor and self-healing, but a maintainer might want the bundled table refreshed alongside the fix above.

Note the two defects pushed in opposite directions — the pricing gap over-reported ~3x while the TTL bug under-reports ~7% — so before the LiteLLM sync the net was roughly 2.7x over.
