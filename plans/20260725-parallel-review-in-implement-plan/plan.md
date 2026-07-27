# Parallel review: a two-engine review skill wired into implement-plan

## Context

`/mzizzi:implement-plan` runs exactly one cross-model review of the code it just wrote. Step 4 calls `mzizzi:codex-adversarial-review`, Step 5 triages what comes back. One engine, one lens — and the lens is fixed by whatever focus text Step 4 happens to pass.

Claude Code ships a built-in `code-review` skill with a different lens entirely: CLAUDE.md adherence, bugs, git-history context, comment guidance, and a verify pass that marks findings CONFIRMED or PLAUSIBLE. It is unreachable from a skill — it declares `disable-model-invocation: true`, and the `Skill` tool refuses it outright ("Skill code-review cannot be used with Skill tool due to disable-model-invocation").

That gate blocks _the model_, not _the user_ — and routing around it via the CLI is documented, supported behavior, not a loophole: the headless docs state that "User-invoked skills and custom commands work in `-p` mode: include `/skill-name` in the prompt string and Claude Code expands it before running" (code.claude.com/docs/en/headless). A slash command in a print-mode prompt counts as user invocation, so the gate doesn't apply. This is the same class of problem `mzizzi:codex-adversarial-review` already exists to solve (that skill shells out to `codex-companion.mjs` to route around `/codex:adversarial-review`'s identical gate), with a different bypass.

So the second reviewer is available. This plan adds `mzizzi:parallel-review` — a skill that runs the Codex adversarial review and the genuine built-in code review concurrently, merges their findings into one deduped list tagged with provenance, and returns it — then shrinks `implement-plan`'s Step 4 to a one-line call into it.

```
parallel-review
  ├─ in parallel
  │    ├─ Codex adversarial review          (Skill → run_review.sh)
  │    └─ built-in /code-review             (headless claude -p subprocess)
  └─ merge, dedup, tag provenance → caller
```

## Design

### Two arms, two shapes

|  | Codex arm | code-review arm |
| --- | --- | --- |
| Reached via | `Skill(codex-adversarial-review)` → `run_review.sh` | new `run_code_review.sh` → `claude -p "/code-review"` |
| Lens | implementation approach, design choices, plan fidelity | CLAUDE.md adherence, bugs, git-history context, comments |
| Target | working-tree diff (`--scope auto`) | working diff (bare invocation) |
| Focus text | receives it | none — runs bare |
| Output | prose report (`Verdict:` / `Findings:` / `Next steps:`) | JSON object extracted from `ReportFindings` |
| Failure | exit 2 = plugin missing, exit 1 = review failed | exit 2 = can't run, exit 1 = run failed |

The lenses are complementary by construction rather than by instruction: Codex gets the focus text and reads the plan document, so plan fidelity rides on that arm; the built-in runs bare because its argument slot selects a _target_, not a lens, and free text there is unverified behavior. Running it bare is what "the genuine built-in, in its usual form" means.

### The code-review arm gets a wrapper script

`run_code_review.sh` under `skills/parallel-review/scripts/`, mirroring `run_review.sh`. The alternative — an inline bash snippet in SKILL.md — loses on four counts, each of which is a reason `run_review.sh` already exists:

1. **Exit-code normalization.** The skill's degradation logic needs three states (ran / couldn't run / ran and failed). Deriving those from a raw `claude -p` invocation means inspecting the exit code _and_ the `result` event's `is_error` _and_ whether a `ReportFindings` call appeared. That's a conditional the model would re-derive every run.
2. **Noise suppression.** The stream-json output is hundreds of events. Only the `ReportFindings` input and the final `result` matter. A script hands back one small JSON object; an inline snippet dumps the whole stream into context.
3. **Multi-pass jq over a captured stream.** Two independent jq passes plus a combine pass, which needs the stream on disk. Awkward as a one-liner, trivial in a script.
4. **Style rule: don't enumerate CLI flags in prose docs.** The flag set belongs in a script where it's executable truth, not in SKILL.md where it's a stale copy.

The script also carries the recursion guard and the effort-flag capability probe, neither of which fits in prose.

### The `claude -p` command line

```bash
timeout --kill-after=15s "${PARALLEL_REVIEW_TIMEOUT_SECONDS:-540}" \
  claude -p "/code-review" \
    --output-format stream-json \
    --model "${PARALLEL_REVIEW_MODEL:-opus}" \
    --effort "${PARALLEL_REVIEW_EFFORT:-high}" \
    --setting-sources user,project \
    --no-session-persistence \
    --max-budget-usd "${PARALLEL_REVIEW_MAX_BUDGET_USD:-10}" \
    --allowedTools "${allowed_tools[@]}" \
    --disallowedTools "${disallowed_tools[@]}" \
    > "$stream_file" 2>"$err_file"
```

Every flag, justified:

- **`-p "/code-review"`** — the whole bypass. Print mode makes the slash command user input in a fresh process, so `disable-model-invocation` doesn't apply. The prompt is a **fixed literal**; nothing is interpolated into it. That is also the recursion guard's first line of defense.
- **`--output-format stream-json`** — `ReportFindings` exists because the host UI renders findings; a headless run's final text may collapse to a prose summary and lose the per-finding detail triage needs. The tool-call _input_ in the event stream carries the typed findings verbatim.
- **`--model`** (param `PARALLEL_REVIEW_MODEL`) — pins the orchestrating session rather than inheriting whatever the settings default happens to be. It does not reach the review's internal fan-out — subagents take their models from their own definitions — so this buys a deterministic orchestrator, no more.
- **`--effort`** (param `PARALLEL_REVIEW_EFFORT`) — added **conditionally**, gated on a `claude --help` probe, so the script degrades to the settings default if a future CLI renames or drops the flag rather than failing on an unknown argument. The user's settings already carry a high effort level, so this is belt-and-braces, not the only path.
- **`--setting-sources user,project`** — makes settings loading explicit instead of relying on print mode's undocumented default. This is what carries the user's model and effort defaults into the subprocess. `local` is deliberately excluded: `settings.local.json` holds per-machine grants, and leaving it out keeps the subprocess's permission surface the same on every machine this runs from.
- **`--no-session-persistence`** — a throwaway review shouldn't land in `/resume` history. Only valid with `--print`, which we have.
- **`--max-budget-usd`** (param `PARALLEL_REVIEW_MAX_BUDGET_USD`) — a hard cost ceiling on an unattended subprocess that fans out to subagents at high effort. Tripping it ends the run with an error, which surfaces through the ordinary exit-1 path — a clean failure instead of a billing surprise. Only valid with `--print`, which we have.
- **`--allowedTools` / `--disallowedTools`** — see below.
- **`timeout`** — the outer `Bash` tool has its own ceiling. The internal timeout sits below it (`PARALLEL_REVIEW_TIMEOUT_SECONDS`) so the script gets to emit a clean "timed out" diagnostic instead of being killed mid-write by the tool. `--kill-after` covers a process that ignores the term signal. The tool's ceiling is a hard 600s that can't be raised, and a tool-level kill leaves no chance to emit a diagnostic — so the internal timeout plus `--kill-after` must stay under it. `PARALLEL_REVIEW_TIMEOUT_SECONDS` is tunable downward only, effective maximum ~580s; a review that can't finish inside ten minutes can't run through this skill as designed.
- **Working directory** — inherited from the `Bash` call, i.e. the repo the caller is in. The subprocess reviews the same working tree the caller sees. No `--add-dir`; the review has no business outside the repo.

**Not** `--permission-mode bypassPermissions`. `implement-plan` calls this with the entire implementation sitting **uncommitted**. An unattended process with edit rights could mutate the very diff it's reviewing, with no record it happened. Permission mode is left at the default: read-only tools are auto-approved, and any other tool call not matched by an allow rule falls through to an approval ask, which in headless mode fails closed.

**Allowlist** (auto-approved):

| Entry | Why a review needs it |
| --- | --- |
| `Read`, `Glob`, `Grep` | read the changed files and their neighbourhood |
| `Agent`, `Task` | the built-in fans out to reviewer subagents; both names listed for CLI-version tolerance |
| `ReportFindings` | the channel the findings come back on — denied means no output |
| `TodoWrite` | the built-in tracks its own review passes |
| read-only `git` subcommands (`status`, `log`, `show`, `blame`, `rev-parse`, `merge-base`, `ls-files`, `diff-tree`, and `diff`) | the diff itself, plus the git-history context the built-in reviews for. Enumerated individually rather than `Bash(git *)` so `checkout`/`commit`/`clean` aren't reachable |

**Denylist** (hard block, belt to the allowlist's braces): the file-writing tools (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`) — a review writes nothing; and the network tools (`WebFetch`, `WebSearch`) — keeps the run hermetic and bounded.

**What this boundary actually is.** The default permission mode auto-approves read-only tools and nothing else, and in headless mode there is no prompt to fall through to — every other tool call is either matched by an allow rule or denied. The effective capability surface is therefore the read-only builtins, plus this allowlist, plus whatever `permissions.allow` rules ride in from user and project settings via `--setting-sources` — wider than the allowlist alone, though every extra grant is one the user made deliberately for their own environment. The consequences cut both ways: the write-block holds even without `--disallowedTools` (kept anyway as documentation of intent), and a non-read tool the review legitimately needs but no rule covers is silently denied — which surfaces not as an error but as a weaker review. Two consequences worth stating plainly rather than assuming away:

- **Prefix rules are coarser than they look.** `Bash(git branch:*)` would permit `git branch -D`, so it's excluded — the built-in can get the current branch from `git rev-parse --abbrev-ref HEAD` instead. `Bash(git diff:*)` permits `git diff --output=<path>`, which writes a file; it stays on the list because the review genuinely can't work without `git diff`, and it's flagged here as a known residual rather than papered over.
- **Hooks and project settings are inherited** via `--setting-sources user,project`, and a hook can run arbitrary commands regardless of the tool allowlist. A concrete instance: the codex plugin's stop-time review gate, if enabled, fires when the subprocess stops — every code-review arm run would trigger a Codex review on its way out. The phase-1 preflight checks the gate's state.

The result is a strong-but-not-airtight boundary: it stops the ordinary failure mode (a review that decides to "helpfully" fix what it found) without pretending to be a sandbox. Whether to invest in real isolation is an open question below.

### Extracting findings from the stream

The stream is NDJSON. When present, `ReportFindings` arrives as a `tool_use` block inside an `assistant` event; a recursive-descent filter finds it regardless of nesting depth. The headless docs state that subagent `tool_use` and `tool_result` blocks are emitted in the parent stream by default, tagged with `parent_tool_use_id` (forwarding anything more is what `--forward-subagent-text` opts into) — so the call should be visible whether the review runs in the main loop or fans out, and the recursive descent handles either nesting. The phase-1 probe still confirms this empirically; what stays genuinely open is whether a `-p` session blocks until a background review completes (see Open Questions).

```bash
# Last ReportFindings tool-call input, or null if the review never called it.
rf=$(jq -n -c '
  [ inputs
    | .. | objects
    | select(.type? == "tool_use" and .name? == "ReportFindings")
    | .input
  ] | last // null' "$stream_file")

# The terminal result event, or null if the stream ended without one.
res=$(jq -n -c '[inputs | select(.type? == "result")] | last // null' "$stream_file")
```

`last` rather than `first`: the tool's own contract allows a re-report after fixes, and the final call is authoritative. `// null` keeps both variables valid JSON so the combine pass can use `--argjson` unguarded.

**Deciding what happened**, in this order:

1. `timeout` returned its timeout status → exit 1, reason names the elapsed limit.
2. `claude` exited non-zero → exit 1, stderr passed through (this is where an unknown-flag or auth error surfaces).
3. `res == null` → the stream ended without a terminal event → exit 1, `review ended without a result event`.
4. `res.is_error == true` → exit 1, with `res.result` as the reason.
5. `rf == null` but the result is a clean success → **ran, but returned nothing structured.** Emit an empty `findings` array with `structured: false`.
6. Otherwise → success with `structured: true`.

That fifth branch needs care in both directions. Treating a missing `ReportFindings` call as a failure would report a clean review as a broken arm every time the code is actually fine. But treating it as positive evidence of "no defects" is a silent false negative: a permission denial, a schema change, a slash-command resolution change, or a review that answered in prose all produce the same absence.

The `structured` boolean is what keeps both honest. The skill never claims "no findings" on a `structured: false` arm — it reports that the arm ran without producing structured output, and surfaces the prose summary so the caller can see what it actually said. A clean review that _did_ call `ReportFindings` with an empty array comes back `structured: true` with zero findings, and that one can be stated plainly as "no findings."

**Success stdout** — one JSON object:

| Field | Type | Source |
| --- | --- | --- |
| `findings` | array | `ReportFindings.input.findings`, verbatim — each entry keeps `file`, `line`, `summary`, `short_summary`, `failure_scenario`, `category`, `verdict`, `outcome` |
| `level` | string \| null | `ReportFindings.input.level` (effort the review ran at) |
| `summary` | string \| null | the terminal `result` event's text — the reviewer's prose, useful when `findings` is empty |
| `structured` | boolean | whether a `ReportFindings` call was actually present. `false` means the empty `findings` array is an absence of data, not a clean bill of health |

```bash
jq -n -c --argjson rf "$rf" --argjson res "$res" '{
  findings:   ($rf.findings // []),
  level:      ($rf.level    // null),
  summary:    ($res.result  // null),
  structured: ($rf != null)
}'
```

**Fallback if the parent stream never carries `ReportFindings`** (the probe resolving negative): force the findings into the final result instead. The CLI's `--json-schema` flag validates the session's structured output against a schema — and it is documented as requiring `--output-format json`, so adopting the fallback swaps stream-json for a single result object and **replaces** the stream extraction outright rather than sitting alongside it. Pass a minimal findings schema (file, line, summary, verdict, category) and extend the prompt to a longer fixed literal: `/code-review` plus one instruction sentence to restate the review's findings as the structured result. Nothing is interpolated, so the recursion guard's first defense holds; the findings arrive in the result object the script reads directly, and `structured` comes to mean "the result validated against the schema." Second-best — the findings are relayed by the orchestrator rather than read verbatim off the tool call — but robust to the subagent boundary, and it forces the main loop to wait for the review before it can produce a result.

### Exit-code contract

Both scripts use the same shape, so the skill's degradation logic is symmetric.

| Code | Codex arm (`run_review.sh`, existing) | code-review arm (`run_code_review.sh`, new) |
| --- | --- | --- |
| 0 | prose report on stdout | JSON object on stdout (`structured` says whether findings data was actually present) |
| 2 | codex plugin not installed (`CODEX_NOT_INSTALLED:`) | can't run at all (`CODE_REVIEW_UNAVAILABLE:`) — `claude` not on PATH, not a git repo, or recursion guard |
| 1 | installed but the review failed — auth, not a git repo, timeout | the run started and failed — non-zero exit, timeout, error result, no terminal event |

This describes `run_review.sh` **after** the exit-status fix in Phase 0. Today it exits 0 on every failure, so nothing downstream can currently distinguish a failed Codex review from an empty one. `parallel-review`'s degradation logic is only meaningful once that's corrected.

### Recursion hazard

`parallel-review` must never run inside the headless subprocess: the subprocess would spawn its own subprocess, and so on. Two defenses:

1. The subprocess prompt is a fixed literal `"/code-review"` — no interpolation, no path by which the subprocess reaches `parallel-review`.
2. `run_code_review.sh` exports a marker variable before invoking `claude`, and refuses with exit 2 if that variable is already set on entry. Environment inherits into the subprocess, so a nested invocation dies immediately instead of forking a tree.

The SKILL.md carries a matching one-line guard so the constraint is visible to a reader who never opens the script.

### Sequencing: how two arms with different shapes go out together

The Codex arm reaches its script through `Skill(codex-adversarial-review)`, which is a tool call that resolves in its own turn. That does **not** cost parallelism, because `Skill()` only loads instructions — it doesn't run anything.

- **Turn 1** — exactly one tool call: `Skill(skill: "codex-adversarial-review", args: "--scope auto <focus text>")`. Nothing else in that message. The result is the skill's instructions, which name the script path and the exit codes.
- **Turn 2** — exactly two tool calls, both `Bash`, both foreground (`run_in_background` unset), both at the maximum timeout, **in the same message**. Independent tool calls in one message run concurrently, and the code-review arm is a separate OS process, so the two genuinely overlap rather than time-slicing the main loop.

Neither arm is wrapped in a subagent, so nothing gets summarized on the way to triage.

One honest caveat: the one-message batching is enforced by prose, not by any mechanism. A run that issues the two calls serially anyway still gets correct results from both arms — it just pays up to double the wall clock. That's an accepted soft failure, not a correctness risk; the SKILL.md states the requirement and the cost of missing it, which is all a skill file can do.

### Merge and dedup

Every finding, from either arm, normalizes to one record:

| Field | Codex source | code-review source |
| --- | --- | --- |
| `arms` | `[codex]` | `[code-review]` — becomes `[codex, code-review]` on a merge |
| `file` | from the `(file:line-range)` suffix | `file` |
| `line` | the range's start | `line` |
| `title` | the finding's title | `short_summary` (fall back to `summary`) |
| `weight` | the `[severity]` marker | `verdict` (CONFIRMED / PLAUSIBLE) + `category` |
| `what` | the body prose | `summary` |
| `failure` | — (often folded into the body) | `failure_scenario` |
| `fix` | the `Recommendation:` line, if present | — |

Missing fields stay empty rather than being invented; the two engines don't report the same shape and pretending otherwise fabricates detail.

**Dedup** — two findings merge when _both_ hold:

1. **Same location.** Same `file`, and the code-review `line` falls inside the Codex line range (or the two lines are within a handful of lines of each other — the engines rarely agree on exactly which line a defect "is on").
2. **Same claim.** The same underlying defect and mechanism, judged by reading both bodies — not by string similarity. "Null deref on `user.profile`" and "missing null check before `user.profile`" are one finding. "Null deref" and "this variable is badly named" at the same line are two.

Same claim at clearly different locations still merges if it's evidently one defect described from different angles (e.g. one arm points at the call site, the other at the definition); keep the more specific location and note both. Merged entries keep **both** weights — a Codex high-severity alongside a code-review CONFIRMED is more informative than either alone — and take the fuller body.

**Ordering:** `[both]` entries first (agreement is the strongest available triage signal), then single-arm entries. Within each group, Codex severity descending, then CONFIRMED before PLAUSIBLE.

### Returned output

```markdown
## Parallel review — 7 findings (2 raised by both arms)

**Arms:** codex ok · code-review ok

### Findings

1. **[both] src/auth/refresh.ts:142** — Concurrent refresh can issue two tokens
   - codex: high · code-review: CONFIRMED / correctness
   - Two callers hitting `refresh()` inside the expiry window both see a stale
     token and both POST to the token endpoint; the second response overwrites
     the first, invalidating a token already handed to a caller.
   - Failure: two requests in flight at expiry → the earlier caller's token 401s.
   - Suggested fix: single-flight the refresh behind a promise cache keyed on
     the account id.

2. **[codex] src/auth/store.ts:31** — Plan specifies encrypted-at-rest storage
   - codex: high
   - The plan's Design section calls for the refresh token to be written through
     the keychain adapter; the implementation writes it to a plain JSON file.

3. **[code-review] src/auth/refresh.ts:88** — Swallowed error hides auth failure
   - code-review: PLAUSIBLE / error-handling
   ...

### Arm status

- **codex** — ok
- **code-review** — ok (level: high)

<details><summary>Raw Codex report</summary>
...verbatim prose report...
</details>

<details><summary>Raw code-review findings (JSON)</summary>
...verbatim JSON object...
</details>
```

Raw output from both arms is appended verbatim so triage can drill into anything normalization flattened. Nothing is written to disk — `implement-plan` already has the durable channel that matters (Step 7 folds deferred findings into the plan's `## Follow-ups`), and `parallel-review` can't assume a plan directory exists when run standalone.

### Degradation

| Situation | What the skill returns |
| --- | --- |
| Both arms ok | merged list, arm status both `ok` |
| One arm exit 1 or 2 | the surviving arm's findings in full, plus an arm-status line naming the failed arm and its stderr reason. Header says `1 of 2 arms` |
| Both arms failed | no findings list. A short "review unavailable" block naming each arm and each reason |
| An arm returns zero findings | `ok — no findings`, not a failure. Its prose summary, if any, goes in the arm-status line |
| code-review arm returns `structured: false` | `ok — ran, no structured findings`. Never reported as "no findings"; the prose summary is surfaced so the caller can see what it said |
| Working tree clean at preflight | say there's nothing to review and stop, before spawning either arm |

Reasons are surfaced verbatim from stderr — the `CODEX_NOT_INSTALLED:` / `CODE_REVIEW_UNAVAILABLE:` prefixes, an auth message pointing at `/codex:setup`, a timeout notice. Plausible subprocess failure modes to name accurately: `claude` not on PATH, an unrecognized flag after a CLI update, the timeout expiring on a large diff, the budget cap tripping mid-review, and a stream that ends without a terminal result event.

## Implementation

### Implementation Phase 0 — make `run_review.sh`'s exit-code contract real

**MODIFY `plugins/mzizzi/skills/codex-adversarial-review/scripts/run_review.sh`** — a standalone bug fix, sequenced first: every degradation test later in this plan is unfalsifiable until it lands, and it's worth shipping even if nothing else here does.

The wrapper's failure path never propagates a failure:

```bash
if ! node "$script" adversarial-review "$focus_args" 2>"$tmp_err"; then
  status=$?          # status of `! node …`, which is 0 whenever this branch runs
  cat "$tmp_err" >&2
  exit "$status"     # exits 0 — a failed review reports success with empty stdout
fi
```

Every documented exit-1 case (auth failure, not a git repo, timeout) currently exits 0 instead. `codex-adversarial-review`'s own SKILL.md documents an exit-code contract the script doesn't honor, and both `create-plan` and `implement-plan` branch on it — so a Codex outage today reads as a review that ran and found nothing. Fix by capturing the status without the negation:

```bash
set +e
node "$script" adversarial-review "$focus_args" 2>"$tmp_err"
status=$?
set -e
if [ "$status" -ne 0 ]; then
  cat "$tmp_err" >&2
  exit "$status"
fi
```

**Testing:** drive the wrapper with a stub `node` exiting 1 and 2, asserting the wrapper exits with the same code and writes nothing to stdout. Exit-status propagation is the most defect-prone part of both wrappers — Phase 1's new script gets the same stub treatment — so it's a scripted check, not eyeballing.

### Implementation Phase 1 — the code-review arm's script

**CREATE `plugins/mzizzi/skills/parallel-review/scripts/run_code_review.sh`**

Runs the built-in `/code-review` headless and prints its findings as one JSON object. Style follows `run_review.sh`: `set -euo pipefail`, a header comment explaining _why_ the bypass exists and why the stream is parsed rather than the final text, a temp file with a `trap` cleanup, stderr noise discarded on success and surfaced only on failure.

```bash
#!/usr/bin/env bash
# Run Claude Code's built-in /code-review over the working diff in a headless
# subprocess and print its findings as JSON.
#
# Usage: run_code_review.sh            # reviews the working tree of $PWD
#
# The built-in code-review skill ships with disable-model-invocation: true, so
# the Skill tool refuses it. That gate blocks the model, not the user: the
# headless docs state that user-invoked skills work in -p mode — a /skill-name
# in the prompt string expands before running. Documented behavior, not a hack.
#
# Findings are read out of the stream-json event stream rather than the final
# text because ReportFindings exists so the host UI can render findings — a
# headless run's final message can collapse to a summary and lose the per-
# finding detail triage needs. The tool-call input carries them verbatim.
#
# stdout on success: {"findings":[...],"level":...,"summary":...,"structured":bool}
# structured=false means the review ran but never called ReportFindings — an
# absence of data, NOT a clean bill of health. Callers must not read the empty
# findings array as "no issues".
# Exit 2 — can't run at all (no claude CLI, not a git repo, nested call).
# Exit 1 — the run started and failed (non-zero exit, timeout, error result).
set -euo pipefail

# Recursion guard: this script spawns a claude session, which inherits the
# environment. If parallel-review ever ran inside that session it would fork
# a subprocess tree. Die instead.
if [ -n "${MZIZZI_PARALLEL_REVIEW:-}" ]; then
  echo "CODE_REVIEW_UNAVAILABLE: refusing to nest — already inside a parallel-review subprocess." >&2
  exit 2
fi

# Preconditions -> exit 2 (distinguishable from a review that ran and failed).
command -v claude >/dev/null 2>&1 || { echo "CODE_REVIEW_UNAVAILABLE: ..." >&2; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "CODE_REVIEW_UNAVAILABLE: ..." >&2; exit 2; }

# The effort flag is probed rather than assumed so a CLI that renames or drops
# it degrades to the settings default instead of dying on an unknown argument.
effort_args=()
if claude --help 2>/dev/null | grep -q -- '--effort'; then
  effort_args=(--effort "${PARALLEL_REVIEW_EFFORT:-high}")
fi

# Enumerated read-only git subcommands — deliberately no `git branch`, which
# would permit `git branch -D`. See the Design section on what this boundary
# does and doesn't enforce.
allowed_tools=( Read Glob Grep Agent Task ReportFindings TodoWrite
                "Bash(git diff:*)" "Bash(git status:*)" ... )
disallowed_tools=( Edit Write MultiEdit NotebookEdit WebFetch WebSearch )

stream_file=$(mktemp); err_file=$(mktemp)
trap 'rm -f "$stream_file" "$err_file"' EXIT

# PARALLEL_REVIEW_TIMEOUT_SECONDS plus --kill-after must stay under the Bash
# tool's hard 600s ceiling — a tool-level kill leaves no diagnostic. Tunable
# downward only; effective max ~580s.
run_review() {   # $@ = extra flags; returns claude's exit status
  MZIZZI_PARALLEL_REVIEW=1 \
  timeout --kill-after=15s "${PARALLEL_REVIEW_TIMEOUT_SECONDS:-540}" \
    claude -p "/code-review" \
      --output-format stream-json \
      --model "${PARALLEL_REVIEW_MODEL:-opus}" \
      "${effort_args[@]}" \
      --setting-sources user,project \
      --no-session-persistence \
      --max-budget-usd "${PARALLEL_REVIEW_MAX_BUDGET_USD:-10}" \
      --allowedTools "${allowed_tools[@]}" \
      --disallowedTools "${disallowed_tools[@]}" \
      "$@" >"$stream_file" 2>"$err_file"
}

# Capture the status with no negation or ||-guard in front of the call:
# `if ! run_review` makes $? the negated status (always 0 in that branch), and
# `run_review || true` resets $? to true's 0. Both silently convert every
# failure into success — run_review.sh shipped with exactly this bug (fixed
# in Phase 0).
set +e
run_review
status=$?
set -e

# Some CLI versions reject stream-json in print mode without --verbose. That
# fails at argument validation before any API call, so the retry is free.
if [ "$status" -ne 0 ] && grep -qi -- '--verbose' "$err_file"; then
  set +e
  run_review --verbose
  status=$?
  set -e
fi

# ... jq extraction and the outcome decision from the Design section
```

Exit-status propagation is the single most defect-prone part of both wrappers, so it gets explicit test coverage rather than eyeballing.

**Integration:** self-contained; the skill invokes it by path via `${CLAUDE_PLUGIN_ROOT}`, exactly as `codex-adversarial-review/SKILL.md` invokes `run_review.sh`.

**Testing:**

- Preflight: check whether the codex plugin's stop-time review gate is enabled (`/codex:setup` reports it). The subprocess inherits plugin hooks, so an enabled gate fires a Codex review at the end of every code-review arm run — silent double cost and wall clock. Disable it for phase 1 if it's on.
- **The gating probe comes first:** run once against the planted-bug diff with the stream file kept, and locate the `ReportFindings` event — parent frame, forwarded subagent frame, or absent. Absent → switch to the `--json-schema` fallback before building anything further on the stream extraction. Confirm in the same run that the session blocked until the background review finished.
- Run it directly from a repo with a deliberately flawed dirty tree; pipe through `jq .` and confirm stdout is one JSON object with populated `findings`.
- Run against a whitespace-only diff; confirm exit 0 with an empty `findings` array and a non-null `summary` — the no-findings path must not look like a failure. Record whether the review called `ReportFindings` with an empty array (`structured: true`) or skipped the call entirely (`structured: false`); this is the first real evidence of which behavior a clean review actually produces.
- Replay a saved stream with the `ReportFindings` events stripped out and confirm the script reports `structured: false` rather than a clean review.
- Exercise exit-status propagation with stub commands returning 1, 2, and the timeout status, asserting the script exits with the same code and writes nothing to stdout.
- Invoke with the recursion marker already set → exit 2, guard message.
- Invoke with a deliberately tiny timeout → exit 1, timeout reason on stderr, nothing on stdout.
- Run from a non-git directory and with `PATH` stripped of `claude` → exit 2 each time.
- Grep the captured stream (temporarily keep the temp file) for permission-denial events. **Zero denials is a ship condition**: each denial either gets its tool added to the allowlist or an explicit accepted-lens-loss note in the Design section. Watch specifically for `Skill` — the built-in review may invoke skills internally (e.g. comment guidance), and `Skill` isn't currently on the list. Adding it is low-risk: the recursion guard's env marker still protects the script, and `code-review` itself stays refused to the Skill tool.

### Implementation Phase 2 — the parallel-review skill

**CREATE `plugins/mzizzi/skills/parallel-review/SKILL.md`**

Frontmatter matches the plugin's house style (`name`, `description`, `argument-hint`, `allowed-tools`, `disable-model-invocation`, `user-invocable`), with `allowed-tools: Bash, Skill`. The `description` should carry both the what and the trigger phrasing, following the pattern the other mzizzi skills use — mentioning the two engines, the `disable-model-invocation` bypass, and trigger words like parallel / cross-model / second-opinion / double review.

Body — the actual proposed prose, since the skill text is the deliverable. Note what it deliberately does **not** contain: any `claude` flag names, timeout values, or model defaults. Those live in the script.

```markdown
# Parallel review

Review the working diff with two engines at once and hand back one merged list.
The Codex arm challenges the implementation approach, design choices, and plan
fidelity; Claude Code's built-in code review runs its own sweep (CLAUDE.md
adherence, bugs, git-history context, comment guidance). Work the steps in order.

**Never run this from inside the headless subprocess** the built-in arm spawns —
it would fork a review tree. The script enforces this, but don't defeat it: the
subprocess prompt is a fixed literal and nothing is interpolated into it.

## 1. Check there's something to review

`git status --porcelain`. If the working tree is clean, say there's nothing to
review and stop — don't spawn either arm.

The optional argument is **focus text** for the Codex arm. The built-in arm runs
bare: its argument slot selects a target, not a lens, so free text there is
unverified behavior.

## 2. Load the Codex arm's contract

Issue this as the **only** tool call in the message:

    Skill(skill: "codex-adversarial-review", args: "--scope auto <focus text>")

That skill owns the Codex contract — script path, exit-code meanings, result
shape. It returns instructions, not a review; nothing has run yet.

## 3. Issue both arms in one message

The next message contains **exactly two Bash calls, emitted together**:

1. the Codex script, exactly as the skill from step 2 describes it
2. `bash "${CLAUDE_PLUGIN_ROOT}/skills/parallel-review/scripts/run_code_review.sh"`

Both foreground (no `run_in_background`), both at the maximum timeout. Emitting
them in one message is what makes them run at once; splitting them across two
messages serializes the pair and doubles the wall clock for no benefit. If you
realize you've issued them serially, let both finish — the results are still
valid; only time was lost.

## 4. Read each arm's result

- **Codex, exit 0** — a prose report: `Verdict:`, a summary, a `Findings:` list
  (severity, title, file:line-range, body, `Recommendation:`), and `Next steps:`.
- **code-review, exit 0** — one JSON object: `findings` (each with `file`,
  `line`, `summary`, `short_summary`, `failure_scenario`, `category`, and a
  CONFIRMED/PLAUSIBLE `verdict`), `level`, `summary`, and `structured`. Check
  `structured` before saying anything about what the review concluded: `true`
  with an empty `findings` array means it looked and found nothing — report
  that plainly. `false` means it produced no findings data at all, which is
  **not** a clean bill of health. Say the arm ran without structured output and
  surface its prose `summary`; don't translate silence into "no issues."
- **Either arm, non-zero** — stdout is empty and stderr is the reason. Keep the
  reason verbatim; it usually names the fix.

## 5. Merge, dedup, tag

Normalize both arms into one list: file, line, title, weight (Codex severity
and/or the built-in's verdict and category), what's wrong, failure scenario,
suggested fix. Leave a field empty when its arm didn't supply it — don't invent
detail to fill the shape out.

Two findings are the same finding when they sit at the same location _and_ make
the same claim. Same file with overlapping or near-adjacent lines is the location
test; the claim test is judgment — the same defect and the same mechanism, not
similar wording. Merge those into one entry tagged `[both]`, keeping both
weights and the fuller body. Different claims at the same line stay separate.

Order `[both]` entries first, then single-arm entries, each group by severity
descending and CONFIRMED before PLAUSIBLE.

## 6. Return the result

Lead with a count and the arm status, then the ordered findings, then each arm's
raw output under a collapsed block so the caller can drill into anything
normalization flattened. Tag every finding `[codex]`, `[code-review]`, or
`[both]` — provenance is the whole point of running two engines.

Nothing is written to disk. The caller decides what to do with the findings.

## Degradation

One arm failing degrades; it doesn't abort. Report the surviving arm's findings
in full, and name the failed arm and its reason in the arm-status block —
throwing away a review that ran because the other engine wasn't authenticated
wastes it. Only when **both** arms fail is the answer "review unavailable",
naming each arm and each reason.
```

**Integration:** invoked by `implement-plan` Step 4, and standalone as `/mzizzi:parallel-review`.

**Testing:**

- Invoke `/mzizzi:parallel-review` standalone against a deliberately flawed uncommitted diff — plant an off-by-one, a swallowed exception, an unchecked null, and a choice that contradicts a nearby CLAUDE.md rule. Confirm: step 2 issues the `Skill()` alone, step 3 issues both Bash calls in one message, both arms return, the merged list carries entries from each, and at least one `[both]` appears.
- Confirm the arm-status block and both raw-output blocks are present.
- Degradation: temporarily make the codex plugin unresolvable (or clear Codex auth) → Codex exits 2, the skill still reports the built-in's findings and names the failed arm. Then break the other arm instead. Then both → "review unavailable".
- Run on a clean tree → the skill stops at step 1 without spawning anything.
- Run in a repo with a trivial diff → both arms return zero findings and the skill says so plainly rather than manufacturing findings.

### Implementation Phase 3 — wire it into implement-plan

**MODIFY `plugins/mzizzi/skills/implement-plan/SKILL.md`**

_Frontmatter `description`_ — the current text advertises a Codex-only review, which is now wrong and is what the model matches on when deciding to trigger.

<!-- prettier-ignore -->
> **Before:** `…turn a plan.md (or a subset of it) into working code, then run a Codex adversarial review of the changes and triage the findings.`
> **After:** `…turn a plan.md (or a subset of it) into working code, then run a parallel cross-model review of the changes and triage the findings.`

The same sentence appears in the skill's opening paragraph and gets the same treatment: _"then subject the resulting changes to a Codex adversarial review"_ → _"then subject the resulting changes to a parallel cross-model review"_.

_Step 0, task-list seed_ — the seeded item names the step, and the name is now wrong:

<!-- prettier-ignore -->
> **Before:** `…implement (a placeholder — expanded below), Codex review, triage, apply trivial fixes, record follow-ups, review comments, summarize.`
> **After:** `…implement (a placeholder — expanded below), parallel review, triage, apply trivial fixes, record follow-ups, review comments, summarize.`

_Step 0, status discipline_ — the "moot step" example assumes one engine:

<!-- prettier-ignore -->
> **Before:** `(e.g. the Codex review is unavailable, so triage has nothing to do)`
> **After:** `(e.g. both review arms are unavailable, so triage has nothing to do)`

_Step 4 — rewritten whole._ The step shrinks from a Codex-specific how-to into a one-call delegation:

```markdown
## Step 4: Parallel review of the implementation

Run a two-engine review of the code you just wrote. The parallel review skill
runs the Codex adversarial review and Claude Code's built-in code review at the
same time and returns one merged, deduped findings list:

    Skill(skill: "parallel-review", args: "focus on correctness, edge cases, error handling, and whether the implementation faithfully follows the plan at <plan document path>")

Where `<plan document path>` is the file from Step 1. The focus text steers the
Codex arm toward code-quality and plan-fidelity concerns; the built-in arm runs
bare over the working diff, applying its own sweep. Between them the diff gets
two independent lenses rather than the same lens twice.

The result is an ordered findings list, each entry tagged with which arm raised
it (`codex`, `code-review`, or `both`), followed by a per-arm status line and
each arm's raw output. Hold the full response for triage in Step 5.

**If one arm is unavailable** (Codex plugin missing or unauthenticated, the
headless review failed or timed out), the skill returns the surviving arm's
findings and names the failed arm and reason. Triage what came back and carry the
gap into the Step 9 summary — a one-engine review is a materially weaker review.

**If both arms are unavailable**, there are no findings to triage. Note the
reasons, tell the user the review was unavailable, and skip to Step 8.
```

_Step 5 — agreement as evidence._ Judgment 1 gains a paragraph; the three judgments and the valid-AND-fix-now-AND-trivial gate are untouched.

> **Appended to judgment 1:** `A finding both arms raised independently is strong evidence it's real — weigh it accordingly. It is not a promotion rule: two models can share a blind spot, and a finding only one arm raised is often the most valuable precisely because the other missed it. Every finding still earns its place on its merits.`

_Step 9 — the review-outcome bullet now covers two arms._

<!-- prettier-ignore -->
> **Before:** `- The Codex review outcome: how many findings, how many you fixed inline, how many you deferred. If the review was unavailable, say so and why.`
> **After:** `- The **review outcome**, covering both arms: which arms ran, how many findings came back and how many both arms raised independently, how many you fixed inline, how many you deferred. Name any arm that was unavailable and why — the user should know when a round got one engine instead of two.`

_Consistency edits_ — two sentences elsewhere name the Codex review as the sole reviewer and would read as stale:

- Step 2: `Step 4's Codex review reads the working-tree diff, so the baseline must be clean.` → `Step 4's review reads the working-tree diff, so the baseline must be clean.`
- Step 3: `The Codex review in the next step reads the working-tree diff.` → `The review in the next step reads the working-tree diff.`

_Step 7's follow-up template gains a provenance line_, so a deferred finding records which engine raised it: add `- **Raised by:** codex / code-review / both` to the `### <short title>` block. Cheap, and it keeps the provenance signal alive past the conversation.

**MODIFY `plugins/mzizzi/skills/codex-adversarial-review/SKILL.md`**

One sentence appended to the "How to run it" paragraph, so its serial-caller wording isn't read as forbidding concurrency:

> **Appended after** `The call must complete before you have a result to act on.` **:** `Concurrent use is expected — mzizzi:parallel-review issues this call in the same message as a second reviewer so the two run at once; "without backgrounding" constrains how this call is issued, not whether other tool calls may accompany it.`

**Testing (phase 3):**

- Run `/mzizzi:implement-plan` end-to-end on a small throwaway plan. Verify the Step 0 task list seeds a "parallel review" item; that Step 4 issues one `Skill()` then two concurrent Bash calls; that triage in Step 5 handles `[both]` tags without special-casing them; and that the Step 9 summary names both arms with counts.
- Break the Codex arm and re-run: the run must complete on one arm, and the Step 9 summary must name the failed arm and reason. Break both: the run must reach Step 8 with the review item marked completed and annotated "skipped — review unavailable", per Step 0's status discipline.
- Read the three modified SKILL.md files end to end afterward and confirm no sentence still implies a single-engine review.

There is no test framework for markdown skills, so all of the above is manual exercise. The cheapest high-value pass is a single standalone `/mzizzi:parallel-review` against a planted-bug diff — it exercises the script, the sequencing, and the merge in one shot.

## Open Questions

- **GATING — does the `-p` session block until the review completes?** The stream-visibility half of the original question is answered by docs: subagent `tool_use` blocks are emitted in the parent stream by default, so `ReportFindings` should be findable wherever the review runs, and the recursive-descent jq handles either nesting. What remains open is contradicted between sources — the commands reference describes `/code-review` running in the current session, while observed 2.1.218 behavior had it running as a background subagent. Phase 1 still opens with the probe: run once against a planted-bug diff, keep the stream file, locate the `ReportFindings` event, and confirm the session blocked until the review finished. An absent event, or a `result` event that can arrive before the review completes → adopt the `--json-schema` fallback (Design § Extracting findings) before building anything further on the stream extraction.
- **Does stream-json in print mode require `--verbose` on the installed CLI?** Neither `--help` nor the docs state such a requirement, but older CLI versions enforced one. The retry is retained defensively; confirm during phase 1 whether it ever fires, and drop it if it doesn't.
- **Does `--setting-sources user,project` change anything, or does print mode already load user settings?** Passing it explicitly is harmless; confirming which is true tells us whether the model and effort flags are load-bearing or redundant with the user's settings.
- **Does coreutils `timeout` reliably terminate the native `claude.exe`?** GNU coreutils `timeout` 8.32 is confirmed present in Git Bash (shadowing the unrelated System32 `timeout.exe`); what's unverified is whether it reliably kills the native binary. `--kill-after` is the backstop; verify with the deliberately short-timeout test in phase 1.

## Resolved Questions

- **Claude-side reviewer is the genuine built-in, not a hand-rolled substitute** — the headless docs confirm user-invoked skills resolve in `-p` mode, so the real thing is reachable through documented behavior; a copy would only approximate it and would drift as Claude Code updates.
- **Complementary lenses, not the same lens twice** — Codex takes approach, design, and plan fidelity (it's the arm that reads the plan); the built-in does its own fixed sweep. Fewer duplicate findings, each engine on its strength.
- **A new reusable skill, not inline in Step 4** — `implement-plan` already delegates every reusable piece to a skill; inlining would make Step 4 the longest step and leave the capability unreachable elsewhere.
- **Named `parallel-review`** — sits cleanly beside `codex-adversarial-review` and `review-comments`, and doesn't bake "exactly two engines" into the name.
- **Both arms are foreground Bash calls in one message** — independent tool calls in one message run in parallel, and the headless review is a separate OS process, so they genuinely overlap. No subagent hop between either report and triage.
- **Built-in runs as a headless subprocess at Opus / high effort** — it's the real skill with its real fan-out, and it stays current as Claude Code updates.
- **Findings extracted from stream-json with jq** — `ReportFindings` exists so the host UI can render findings; a headless run's final text may collapse to a summary. The tool-call input carries the typed findings verbatim.
- **Read-only tool allowlist, not bypassed permissions** — the implementation sits uncommitted while the review runs; an unattended process with edit rights could mutate the very diff it's reviewing. A review writes nothing, so least privilege costs nothing.
- **The allowlist is the boundary; its residuals are documented, not engineered away** — it blocks the realistic failure mode (a review that "helpfully" fixes what it found). Closing the rest would mean isolated settings with hooks disabled plus audited git wrappers; isolating settings would also cut CLAUDE.md out of a review whose lenses include CLAUDE.md adherence. Disproportionate for a personal-toolchain skill, so the gap is stated rather than claimed shut.
- **A missing `ReportFindings` call is reported as absent data, not as a clean review** — the two are indistinguishable from the exit code alone, and silently converting absence into "no issues" is a false negative exactly when the integration drifts. The `structured` flag lets the skill say which happened.
- **Codex arm goes through `codex-adversarial-review`, not straight to `run_review.sh`** — that SKILL.md owns the Codex contract and now has three callers; one owner, one file to update. The extra `Skill()` turn costs a round-trip but not parallelism.
- **Focus text routes to the Codex arm only** — the built-in's argument slot selects a target, not a lens. Plan-fidelity coverage therefore rides entirely on the Codex arm, accepted knowingly.
- **Working diff only** — the two engines have no shared target vocabulary for PRs; bridging them is scope creep against a target `implement-plan` never needs.
- **One arm failing degrades rather than aborts** — redundancy is what two engines buy; discarding a review that ran because the other wasn't authenticated wastes it. `implement-plan`'s "review unavailable → Step 8" branch narrows to "both arms failed".
- **One merged list with provenance, raw output appended** — "both engines independently flagged this" is the most useful triage signal available and it's free here; side-by-side output would make every caller redo the dedup.
- **Agreement is evidence, not a promotion rule** — a hard rule lets a blind spot the two models _share_ bypass judgment, and inverts the point of the second engine.
- **Always on, no opt-out flag** — Step 0 exists specifically to protect the review tail; a skip flag invites skipping the step the skill was built to defend.
- **Reports stay in the conversation** — Step 7 already folds valid deferred findings into the plan's `## Follow-ups`, and `parallel-review` can't assume a plan directory exists when run standalone.
- **The code-review arm gets a wrapper script** — it normalizes three exit states, swallows a large event stream down to one JSON object, needs multi-pass jq over a captured file, and keeps CLI flags out of prose docs. Same reasons `run_review.sh` exists.
- **`--model` pins the main loop only** — subagents take their model from their own definition files, not the parent session's flag, so the pin buys a deterministic orchestrator and nothing more. Kept anyway; the plan makes no claim the review's internal fan-out runs at the pinned model.
- **`--effort` exists on the installed CLI** (2.1.220: `--effort <level>`, low through max) — the `--help` probe stays as cheap future-proofing, not as the thing that makes the flag safe today.
- **Default permission mode, not `dontAsk`** — the default mode auto-approves read-only tools, and every other unmatched tool call is denied outright in headless mode (there is no prompt to show), with the denial reported to the model rather than hanging. `dontAsk` would make the allow rules the entire surface — including denying read-only tools the list forgot — converting every allowlist omission into silent lens-loss. The default mode's failure direction is the safe one: the review can read more than the list anticipated, but still can't write. The residual risk is silent lens-loss from a denied non-read tool, which the phase-1 denial-grep ship condition covers.

## Follow-ups

- **PR review as a target.** Deferred as scope creep. The Codex arm is git-ref based (`--scope auto|working-tree|branch`, `--base <ref>`) and has no PR concept; the built-in takes a PR number. Bridging them needs `gh` translation plus a guard that the PR's head branch is the current checkout — without it the two arms review different diffs and the merged list silently mixes them. Revisit if a caller other than `implement-plan` wants it.
- **Refresh the plugin's skill enumeration.** `plugins/mzizzi/.claude-plugin/plugin.json`'s description and `README.md` both list the plugin's skills by name and are already stale. Adding `parallel-review` makes that staler. Worth one pass that regenerates both lists rather than patching in a single name.

Findings from the phases 0–2 implementation review that were not fixed in that round.

### Reconcile this plan's Design section with what was actually built

- **What:** The Design section specifies extracting typed findings from a `ReportFindings` tool call in a stream-json event stream, with `--json-schema` as the fallback. Phase 1 measurement disproved both: a headless `/code-review` never calls `ReportFindings`, and it runs as a local command with `num_turns: 0`, so there is no orchestrator turn for a schema instruction to act on — appending one actually suppressed the report. The shipped design captures prose via `--output-format json`. Several Open Questions are also now answered (`--verbose` is required with stream-json; `timeout` does kill `claude.exe` cleanly with no orphans; `--setting-sources` is inherited and hooks do fire in the subprocess), and one hazard is missing entirely (Git Bash MSYS argument conversion silently rewrites `/code-review` into a path, degrading the slash command into an ordinary prompt).
- **Where:** `plan.md` § Design (Extracting findings from the stream, Exit-code contract, Returned output), § Open Questions.
- **Why deferred:** Documentation reconciliation, not code. It matters most before Phase 3 is implemented from this document, since a reader following the Design section as written would build the wrong thing.
- **Suggested fix:** Rewrite the extraction subsection around the prose contract, move the three answered Open Questions into Resolved Questions with their measured answers, and add the MSYS conversion hazard as a named platform constraint.
- **Also dropped from the shipped script, and why:** `--max-budget-usd` and `PARALLEL_REVIEW_TIMEOUT_SECONDS` (knobs nobody sets, and the timeout apparatus dragged a GNU coreutils dependency onto macOS for a marginally nicer message than the caller's own deadline gives); `--model`, `--effort` and the `--help` probe behind them (the same `num_turns: 0` measurement that killed the schema fallback means they configure a main loop that never inferences — a review run without them produced identical findings); and most of the tool allowlist (a headless run makes no visible tool calls, so only the write-tool denylist defends a hazard that demonstrably exists). The Design section argues for all of these at length; those arguments rest on the same invalidated assumptions.

### `codex-companion.mjs` exit 2 is indistinguishable from `CODEX_NOT_INSTALLED`

- **What:** Now that `run_review.sh` propagates the real status, an exit 2 originating inside `codex-companion.mjs` arrives at the caller identical to the wrapper's own "plugin isn't installed" exit 2. A caller would tell the user to install a plugin that is already installed.
- **Where:** `plugins/mzizzi/skills/codex-adversarial-review/scripts/run_review.sh:53` (the status passthrough).
- **Why deferred:** Needs thought, not a one-liner. Remapping the underlying 2 to a distinct code changes a documented contract that `create-plan`, `implement-plan`, and now `parallel-review` all branch on, so it wants a deliberate pass over all three callers.
- **Suggested fix:** Reserve 2 for the wrapper's own precondition failures and remap any underlying non-zero status other than 1 onto 1 (the "installed but failed" case), keeping the companion's stderr verbatim so the real reason still reaches the user.

### Step 1's clean-tree gate skips reviewable committed work

- **What:** `parallel-review` stops when `git status --porcelain` is empty, but both engines can review committed work — Codex `--scope auto` sees commits, and the built-in scopes primarily to `@{upstream}...HEAD`. On a branch whose work is committed, the skill reports "nothing to review" over a perfectly reviewable diff.
- **Where:** `plugins/mzizzi/skills/parallel-review/SKILL.md` § 1.
- **Why deferred:** It contradicts the plan's explicit "working diff only" decision, so widening the target is a design change rather than a fix. It's also latent for the `implement-plan` caller, which always calls with the implementation uncommitted.
- **Suggested fix:** Gate on "is there anything either arm would see" — dirty tree **or** commits ahead of the upstream/trunk — and state in the skill which target each arm actually picked, so a merged list can never silently mix two different diffs.

### No in-script guard for the codex stop-time review gate

- **What:** The subprocess inherits plugin hooks via `--setting-sources user,project`. With the codex plugin's stop-time review gate enabled, every code-review arm run would fire a Codex review on its way out — silent double cost, and it competes for the arm's own timeout budget. Phase 1 verified the gate is currently off (`stopReviewGate: false`), but nothing prevents it being turned on later.
- **Where:** `plugins/mzizzi/skills/parallel-review/scripts/run_code_review.sh` (the `claude` invocation).
- **Why deferred:** The preflight the plan asked for was a one-time build-time check, which was done. Turning it into a runtime guard is a new requirement, and the options differ in cost: read the gate's state file and warn, or suppress hooks outright and lose CLAUDE.md-adjacent settings with them.
- **Suggested fix:** Read `stopReviewGate` out of the codex plugin's state JSON as a precondition and emit a warning (not a failure) on stderr when it's on, so the cost is visible rather than mysterious.

### The read-only boundary is narrower than "read-only"

- **What:** `--setting-sources user,project` merges the user's and project's `permissions.allow` rules into the unattended reviewer, and allow rules are additive. An inherited `Bash(...)` grant, or any hook, can therefore write to the very tree being reviewed — the invariant the allowlist exists to protect. Currently low-risk in this environment specifically (user settings carry no hooks and an empty allow list), but that's a property of the machine, not of the design.
- **Where:** `plugins/mzizzi/skills/parallel-review/scripts/run_code_review.sh` (`--setting-sources`, `allowed_tools`, `disallowed_tools`).
- **Why deferred:** The plan already resolved this as a documented residual rather than an engineered guarantee, and closing it runs straight into the tension the plan named: isolating settings would cut project CLAUDE.md out of a review whose lens _is_ CLAUDE.md adherence. Reopening it is a scope decision, not a fix.
- **Suggested fix:** If it's ever worth closing, the shape is a purpose-built settings file that carries CLAUDE.md discovery but no `permissions.allow` and no hooks, plus a post-run assertion that the working tree's hash is unchanged — cheap, and it turns the invariant into something checked rather than assumed.
