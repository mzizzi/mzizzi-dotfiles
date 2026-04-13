---
name: design-review
description: Review the high-level design and architecture of one or more modules. Evaluates whether the right abstractions, patterns, and architectural choices were made. Use when the user asks to review design, architecture, abstractions, or interfaces — or asks "is this the right approach".
argument-hint: [modules to review, e.g. "src/auth and src/middleware"]
allowed-tools: Read, Grep, Glob, Agent, WebSearch, WebFetch, Write, Skill
---

# Design Review

Review whether the high-level approach, abstractions, and architectural choices are correct and appropriate within the context of the application.

## Multi-module reviews

When reviewing multiple modules together, evaluate the interfaces and dependency direction *between* them — not just each module in isolation. Cross-module concerns (who owns shared state, which direction data flows, where the coupling points are) are often where the most consequential design issues live.

## Gather context (in parallel)

Run these concurrently using subagents.

### Internal context

Read all code in the modules under review — every file, completely. Also read:

- Test suites covering the modules
- Configuration models and entry points that consume the modules

Understand the project's goals and constraints *before* forming opinions.

Determine whether the code under review runs on a hot path (request handling, render loops, real-time processing) or a cold path (initialization, configuration, migration, background jobs). Calibrate performance findings accordingly — hot-path code warrants stricter latency scrutiny.

### External context (only if explicitly requested)

Skip this lane unless the user's prompt explicitly asks for external comparisons or state-of-the-art research. When requested, search the web for how other projects solve the same problems. Cast a wide net — the best comparisons may come from outside the obvious adjacent domain. **Use the built-in `WebSearch` and `WebFetch` tools for all web access.**

For each finding, note:
- What approach they use and key differences from this implementation
- Lessons or best practices that inform the assessment
- Links so the author can dig deeper

### Codex adversarial review

Invoke the Codex adversarial review skill to get a cross-model design critique from GPT-5.4:

    Skill(skill: "codex:adversarial-review", args: "--wait --scope auto focus on architecture and design choices in <module path>")

Where `<module path>` is derived from the user's arguments (e.g., for "myapp.auth", use "myapp/auth/"). The focus text steers Codex toward design concerns. The `--wait` flag ensures results return before synthesis.

The output is structured JSON with a `findings` array. Each finding has `severity`, `title`, `body`, `file`, `line_start`, `line_end`, `confidence`, and `recommendation`. Hold these findings for the synthesis step.

If the Codex skill fails (authentication, CLI unavailable), note the failure and continue with the other lanes.

## Produce the analysis

### Design checklist

Apply these principles when evaluating the design. Flag violations as findings:

- **One method, one concern.** Large methods handling multiple concerns are untestable in isolation. Each should be a focused method with clear inputs/outputs; the original becomes a thin orchestrator.
- **Actively decide where each concern lives.** Ask "who should own this?" The wrong component regularly gets a responsibility by default — display logic drifts into domain objects, infrastructure leaks into business logic.
- **Enumerate what consumers actually depend on, not just the public API.** Every undocumented dependency becomes a bug when you refactor the provider or build a test fake.
- **When test setup is ugly, the real interface is wrong.** If faking a dependency requires replicating complex internal structure, the production interface has too much coupling. Narrow signatures to accept what they actually use.
- **Use Protocols (or equivalent) for dependency injection.** A named interface is self-documenting, extensible, and satisfies duck typing. Prefer this over bare callables for interfaces that represent a concept.
- **Name things for what they represent, not how they're implemented.** Config fields describe purpose. Variables reflect domain concepts.
- **Make data flow direction and state ownership explicit.** For each piece of shared state, there should be a clear producer, consumer, and handoff point. Ambiguous ownership leads to race conditions, stale reads, and update-order bugs — especially in hot-path code.

### Scorecard dimensions

Rate each applicable dimension (1-10). Skip any that don't apply; add domain-specific ones if needed:

| Category | What to evaluate |
|---|---|
| **Separation of Concerns** | Does each component have a single, well-defined responsibility? |
| **Interfaces & Contracts** | Are interfaces minimal, explicit, and sufficient for all consumers? |
| **Dependency Direction** | Do dependencies point inward? Is the dependency graph acyclic and sensible? |
| **Composability** | Can components be recombined, faked, or replaced without surgery? |
| **Extensibility** | Can the design accommodate known future requirements without rework? |

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

Write the full analysis to `.nocommit/<module>-design-review.md` with:

1. Scorecard table (dimensions, scores, notes)
2. Per-dimension analysis with findings
3. Comparison to external state of the art (only if external context was gathered)
4. Ranked recommendations
5. Cross-model agreement summary: corroborated findings, single-model findings, notable disagreements. Omit this section if Codex was unavailable.

## Consistency check

Before presenting the review, re-read the output end-to-end and verify there are no internal contradictions. Specifically check:

- Findings that contradict each other (e.g., one finding says a dependency is too tight, another assumes the same dependency is correct).
- Scorecard scores that don't match the severity or count of findings in the per-dimension analysis.
- Recommendations that conflict with each other or with the findings they reference.

Fix any issues found.

## Example invocations

- `/design-review src/auth and src/middleware`
- `/design-review the routing layer in src/api/router.py`
- `/design-review assess the state machine architecture`
