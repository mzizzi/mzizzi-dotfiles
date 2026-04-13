---
name: impl-review
description: Review the implementation quality of one or more modules. Evaluates algorithmic correctness, performance, edge cases, error handling, and code quality within the chosen design. Use when the user asks to review implementation, code quality, correctness, performance, or test coverage.
argument-hint: [modules to review, e.g. "src/auth and src/middleware"]
allowed-tools: Read, Grep, Glob, Agent, WebSearch, WebFetch, Write, Skill
---

# Implementation Review

Review whether the specific implementation is effective at achieving its goals within the chosen design.

## Multi-module reviews

When reviewing multiple modules together, look for cross-module implementation concerns that a single-module review would miss: duplicated logic that should be shared, inconsistent error handling patterns, mismatched assumptions about data formats or invariants at module boundaries.

## Gather context (in parallel)

Run these concurrently using subagents.

### Internal context

Read all code in the modules under review — every file, completely. Also read:

- Test suites covering the modules
- Configuration models and entry points that consume the modules

Understand the project's goals and constraints *before* forming opinions.

Determine whether the code under review runs on a hot path (request handling, render loops, real-time processing) or a cold path (initialization, configuration, migration, background jobs). Calibrate performance findings accordingly — hot-path code warrants stricter latency scrutiny.

### External context (only if explicitly requested)

Skip this lane unless the user's prompt explicitly asks for external comparisons or state-of-the-art research. When requested, search the web for how other projects solve the same problems. Cast a wide net. **Use the built-in `WebSearch` and `WebFetch` tools for all web access.**

For each finding, note:
- What approach they use and key differences from this implementation
- Lessons or best practices that inform the assessment
- Links so the author can dig deeper

### Codex adversarial review

Invoke the Codex adversarial review skill to get a cross-model implementation critique from GPT-5.4:

    Skill(skill: "codex:adversarial-review", args: "--wait --scope auto focus on implementation correctness, edge cases, error handling, and performance in <module path>")

Where `<module path>` is derived from the user's arguments (e.g., for "myapp.auth", use "myapp/auth/"). The focus text steers Codex toward implementation concerns rather than design concerns. The `--wait` flag ensures results return before synthesis.

The output is structured JSON with a `findings` array. Each finding has `severity`, `title`, `body`, `file`, `line_start`, `line_end`, `confidence`, and `recommendation`. Hold these findings for the synthesis step.

If the Codex skill fails (authentication, CLI unavailable), note the failure and continue with the other lanes.

## Produce the analysis

### Implementation checklist

Apply these principles when evaluating the code. Flag violations as findings:

- **Fix root causes, not symptoms.** Band-aids mask problems. Layer fixes only when each layer addresses a different root cause.
- **Classify failure modes precisely.** Misclassifying a failure prevents the correct recovery system from engaging. Error handling must match what actually went wrong.
- **Recovery systems need memory.** A system that retries without remembering where it failed will repeat the same failure. Record failures and penalize them.
- **Factor repeated comparisons into enums or constants.** When the same string/value is compared in multiple places, centralize it to prevent typos and make valid values discoverable.
- **Name things for what they represent, not how they're implemented.** Config fields describe purpose. Variables reflect domain concepts.
- **Guard shared mutable state across threads.** Background threads (I/O workers, event producers, async I/O) that read or write state consumed by the main thread or hot path need explicit synchronization or a safe handoff pattern. A data race that only manifests under load is hard to diagnose after the fact.
- **Pair every resource acquisition with a guaranteed release.** Context managers, file handles, network connections, GPU memory — if acquisition can succeed, cleanup must be reachable on every exit path including exceptions. Leaks compound over long-running sessions.

### Scorecard dimensions

Rate each applicable dimension (1-10). Skip any that don't apply; add domain-specific ones if needed:

| Category | What to evaluate |
|---|---|
| **Algorithmic Correctness** | Are the algorithms sound? Backed by literature? Any subtle bugs? |
| **Error Handling** | Are failure modes classified correctly? Are root causes addressed? |
| **Performance** | Does it meet constraints? Known scaling risks? Latent traps? |
| **Code Quality** | Readability, consistency, encapsulation, appropriate use of enums/constants |
| **Test Coverage** | Breadth, edge cases, resilience testing, gaps |

### Classify every finding

- **Bug** — Incorrect behavior that exists today
- **Latent risk** — Correct today but breaks under a specific future scenario (name the scenario)
- **Hygiene** — Readability, encapsulation, or style improvement with no correctness impact

### Integrate Codex findings

The Codex adversarial review returned structured findings. For each Codex finding:

1. Map to Bug / Latent risk / Hygiene using severity, confidence, and body text as context. High-severity + high-confidence findings describing current incorrect behavior are Bugs. Lower-confidence or scenario-dependent findings are Latent risks. Low-severity style/clarity issues are Hygiene.
2. Check if your own analysis independently identified the same issue (same file region, same concern). If so, note the cross-model agreement — this strengthens the finding.
3. New Codex findings get a "[Codex]" provenance tag. Evaluate whether you agree given your full codebase understanding.
4. Keep Claude-only findings — note they are single-model.

### Recommendations

End with a ranked list. For each, explain what it protects against so the author can judge the tradeoff.

## Output format

Write the full analysis to `.nocommit/<module>-impl-review.md` with:

1. Scorecard table (dimensions, scores, notes)
2. Per-dimension analysis with findings
3. Comparison to external state of the art (only if external context was gathered)
4. Ranked recommendations
5. Cross-model agreement summary: corroborated findings, single-model findings, notable disagreements. Omit this section if Codex was unavailable.

## Consistency check

Before presenting the review, re-read the output end-to-end and verify there are no internal contradictions. Specifically check:

- Findings that contradict each other (e.g., one finding says error handling is missing, another assumes it exists).
- Scorecard scores that don't match the severity or count of findings in the per-dimension analysis.
- Recommendations that conflict with each other or with the findings they reference.

Fix any issues found.

## Example invocations

- `/impl-review src/auth and src/middleware`
- `/impl-review the query builder in src/db/query.py`
- `/impl-review test coverage for src/services`
