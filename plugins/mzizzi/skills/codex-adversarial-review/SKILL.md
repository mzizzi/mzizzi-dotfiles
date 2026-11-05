---
name: codex-adversarial-review
description: "Run a cross-model Codex adversarial review of a plan or draft document, callable programmatically (unlike /codex:adversarial-review, which is gated to human invocation). Use when a document needs an adversarial challenge from another model."
argument-hint: "<focus/scope text, same as you'd pass to /codex:adversarial-review>"
allowed-tools: Bash
disable-model-invocation: false
user-invocable: true
---

# Codex Adversarial Review

Run a Codex adversarial review with the bundled script. `/codex:adversarial-review` sets `disable-model-invocation: true`, so a model can't call it.

## How to run it

Run the bundled script with one review target:

- `--files <paths>` — only those files: their staged diff, unstaged diff, and current contents.
- `--base <ref>` — default `HEAD`: uncommitted changes and untracked files. With another ref, also the commits since the merge base with `<ref>`.

`--model` and `--effort` pick the Codex model and reasoning effort; anything else is focus text:

```bash
node "<skill-dir>/scripts/run_review.mjs" --model gpt-6-astra --effort high --files plans/20260615-token-refresh/plan.md "focus on feasibility, completeness, missing risks, and questionable assumptions"
```

`<skill-dir>` is the directory this `SKILL.md` was loaded from.

Run it without backgrounding (no `run_in_background: true`) and with a generous timeout — the script has no internal cap on how long a Codex review can take, so give it the maximum (600000ms).

**Model.** Pass `--model` and `--effort` as shown on every run. Without them the review uses the Codex CLI's configured default.

## Reading the result

- **Success:** stdout is the same markdown-formatted review report `/codex:adversarial-review` would print for a human — a `Verdict:`, a summary, a `Findings:` list (each with severity, title, file:line, body, and recommendation), and a `Next steps:` list.
- **Failure:** stdout is empty; the reason is on stderr and the exit code distinguishes why:
  - **Exit 2** — the review never started: the codex plugin is missing or no longer exposes what the script imports, or an argument was bad.
  - **Exit 1** — the codex plugin is installed but the review itself failed (Codex CLI not authenticated, not inside a git repository, timeout, etc.). The stderr text is Codex's own error, passed through unchanged — it often names the specific fix (e.g. pointing at `/codex:setup`) — or `Codex returned no report.` when the turn gave neither an error nor a report.

  Either way the review is unavailable: report the stderr text as the reason to the caller and stop. It is not a fatal error.
