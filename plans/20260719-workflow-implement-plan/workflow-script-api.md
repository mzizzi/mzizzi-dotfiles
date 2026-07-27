# Claude Code Dynamic Workflow — In-Script API (runtime contract)

This is the contract the workflow runtime delivers to the model at runtime (the "spec" that is embedded in `claude.exe` and never published as a docs page). Reconstructed from the live tool contract in a Claude Code session, July 2026. The published counterparts are https://code.claude.com/docs/en/workflows (concepts + one example) and the `WorkflowInput`/`WorkflowOutput` envelope types in `@anthropic-ai/claude-agent-sdk` (`sdk-tools.d.ts`).

## Script format

- Plain **JavaScript, not TypeScript** — type annotations, interfaces, and generics fail to parse.
- The body runs in an async context: use top-level `await` directly.
- Standard JS built-ins (`JSON`, `Math`, `Array`, …) are available, **except** `Date.now()`, `Math.random()`, and argless `new Date()` — these **throw**, because every `agent()` call is journaled so a run can resume, and non-determinism would invalidate that cache. Pass timestamps/seeds in via `args`; stamp results after the workflow returns.
- No filesystem or Node.js API access. Agents do the I/O; the script coordinates.
- The script's `return` value is the consolidated result delivered back to the session.

## The `meta` block

Must be the **first statement**, and a **pure literal** — no variables, function calls, spreads, or template interpolation:

```javascript
export const meta = {
  name: 'find-flaky-tests',            // required
  description: 'Find flaky tests…',    // required; shown in permission dialog
  whenToUse: '…',                      // optional; shown in the workflow list
  phases: [                            // optional; one entry per phase() call
    { title: 'Scan', detail: 'grep test logs for retries' },
    { title: 'Fix',  detail: 'one agent per flaky test', model: 'sonnet' },
  ],
}
```

Phase titles in `meta.phases` are matched **exactly** against `phase()` calls; a `phase()` with no matching meta entry still gets its own progress group. Add `model` to a phase entry when that phase uses a model override.

## Globals

### `agent(prompt, opts?) → Promise<any>`

Spawns one subagent. Without `schema`, resolves to the agent's final text as a string. Options:

| Option | Effect |
| --- | --- |
| `schema` | JSON Schema. Forces the subagent to call a StructuredOutput tool; validation happens at the tool-call layer, so the model retries on mismatch. `agent()` returns the validated object — no parsing needed. |
| `label` | Display label in the progress view. |
| `phase` | Explicitly assigns the agent to a progress group. Use this inside `pipeline()`/`parallel()` stages — the global `phase()` state races there. Same phase string → same group box. |
| `model` | Per-call model override. Default to omitting it — the agent inherits the session model, which is almost always correct. |
| `effort` | Reasoning-effort override: `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`. Omit to inherit. `'low'` for cheap mechanical stages; higher tiers for the hardest verify/judge stages. |
| `isolation` | `'worktree'` runs the agent in a fresh git worktree. **Expensive** (~200–500 ms setup + disk per agent); use only when agents mutate files in parallel and would conflict. Auto-removed if unchanged. |
| `agentType` | Use a custom subagent type (e.g. `'general-purpose'`, `'code-reviewer'`) instead of the default workflow subagent — same registry as the Agent tool. Composes with `schema`. |

Returns `null` (does not reject) if the user skips the agent mid-run or it dies on a terminal API error after retries — `.filter(Boolean)` results.

Subagents are told their final text IS the return value, not a human-facing message, so they return raw data.

### `pipeline(items, stage1, stage2, …) → Promise<any[]>`

Runs each item through all stages independently with **no barrier between stages** — item A can be in stage 3 while item B is still in stage 1. This is the **default** for multi-stage work; wall-clock = slowest single-item chain.

- Every stage callback receives `(prevResult, originalItem, index)` — use `originalItem`/`index` in later stages to label work without threading context through stage 1's return value.
- A stage that throws drops that item to `null` and skips its remaining stages.

### `parallel(thunks) → Promise<any[]>`

Runs an array of `() => Promise<any>` thunks concurrently and **awaits all** before returning (a barrier). A thunk that throws resolves to `null` in the result array — the call itself never rejects.

A barrier is correct **only** when the next stage needs cross-item context from all prior results: dedup/merge across the full set, early-exit on zero findings, or prompts that reference "the other findings". It is _not_ justified by "I need to flatten/map/filter first" (do that inside a pipeline stage) or "the stages are conceptually separate".

### `phase(title)`

Starts a new phase; subsequent `agent()` calls group under it in the progress display. Racy inside concurrent stages — prefer `opts.phase` there.

### `log(message)`

Emits a narrator line above the progress tree. Use it to mark transitions, report counts, and disclose any coverage bounds (top-N, sampling) — silent truncation reads as "covered everything".

### `args`

The value passed as the Workflow invocation's `args` input, verbatim (`undefined` if not provided). Arrays/objects arrive as real JSON values, so `args.map`/`args.filter` work directly.

### `budget`

`{ total: number|null, spent(): number, remaining(): number }` — the turn's token target (e.g. from a "+500k" directive). `total` is `null` if no target; `remaining()` is then `Infinity`. The target is a **hard ceiling**: once `spent()` reaches `total`, further `agent()` calls throw. The pool is shared across the main loop and all workflows.

```javascript
while (budget.total && budget.remaining() > 50_000) { /* … */ }
const FLEET = budget.total ? Math.floor(budget.total / 100_000) : 5
```

Guard on `budget.total` — with no target set, an unguarded loop runs straight into the agent cap.

### `workflow(nameOrRef, args?) → Promise<any>`

Runs another workflow inline and returns its result. Pass a saved workflow's name, or `{ scriptPath }` for a script file on disk. The child shares the parent's concurrency cap, agent counter, abort signal, and token budget; its agents appear under a `▸ name` group. **One level of nesting only** — `workflow()` inside a child throws. Throws on unknown name / unreadable path / child syntax error.

## Runtime limits

| Limit | Value |
| --- | --- |
| Concurrent agents | `min(16, cpu cores − 2)`; excess calls queue |
| Agents per run (lifetime) | 1,000 |
| Items per single `pipeline()`/`parallel()` call | 4,096 (explicit error beyond) |
| Mid-run user input | None — only permission prompts can pause a run |

## Invocation envelope and resume

Invoked with one of `script` (inline), `name` (bundled or `.claude/workflows/`), or `scriptPath` (wins over both). `args` becomes the script global. Every run persists its script under the session directory and returns `scriptPath` + `runId`.

Resume: relaunch with `{ scriptPath, resumeFromRunId }`. The longest unchanged prefix of `agent()` calls (same prompt + opts) returns cached results instantly; the first edited/new call and everything after runs live. Same session only; stop the prior run first. The journal at `<transcriptDir>/journal.jsonl` records each agent's actual return value; per-agent transcripts are `agent-<id>.jsonl`.

## Quality patterns (from the contract)

- **Adversarial verify** — N independent skeptics per finding, each prompted to _refute_; kill on majority refutation.
- **Perspective-diverse verify** — distinct lenses (correctness, security, perf, repro) instead of N identical refuters.
- **Judge panel** — N independent attempts from different angles, scored by parallel judges, synthesized from the winner.
- **Loop-until-dry** — keep spawning finders until K consecutive rounds find nothing new; dedup against everything _seen_, not just confirmed, or judge-rejected findings reappear forever.
- **Multi-modal sweep** — parallel agents each searching a different way.
- **Completeness critic** — a final agent asking "what's missing?"; its output seeds the next round.

Canonical multi-stage shape — pipeline by default, verify starts per-dimension as soon as that dimension's review completes:

```javascript
const results = await pipeline(
  DIMENSIONS,
  d => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FINDINGS }),
  review => parallel(review.findings.map(f => () =>
    agent(`Adversarially verify: ${f.title}`, { phase: 'Verify', schema: VERDICT })
      .then(v => ({ ...f, verdict: v }))
  ))
)
const confirmed = results.flat().filter(Boolean).filter(f => f.verdict?.isReal)
```
