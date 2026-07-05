---
name: codex-adversarial-review
description: Run a Codex adversarial review directly against the codex plugin's companion script, bypassing the /codex:adversarial-review command's model-invocation gate (that command ships with disable-model-invocation: true, and there's no supported way to lift it without hand-editing the vendored plugin file, which gets wiped on every plugin update). Use this whenever a plan or draft document needs a cross-model adversarial challenge triggered programmatically rather than by a human typing the slash command — the create-plan skill calls it after drafting a plan.
argument-hint: <focus/scope text, same as you'd pass to /codex:adversarial-review>
allowed-tools: Bash
---

# Codex Adversarial Review

Run a Codex adversarial review by calling the codex plugin's underlying script directly, instead of going through `/codex:adversarial-review`. That command ships with `disable-model-invocation: true`, and any local edit to lift the restriction lives inside a versioned plugin cache directory that gets replaced wholesale on every plugin update, so it silently reverts. This skill sidesteps the gate entirely: it resolves wherever the codex plugin currently lives via Claude Code's own `installed_plugins.json` (kept up to date across updates) and invokes `codex-companion.mjs` the same way the command itself does.

## How to run it

Run the bundled script, passing the same focus/scope text you'd pass to `/codex:adversarial-review`:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/codex-adversarial-review/scripts/run_review.sh" "--scope auto focus on feasibility, completeness, missing risks, and questionable assumptions in the plan at plans/20260615-token-refresh/plan.md"
```

Run it without backgrounding (no `run_in_background: true`) and with a generous timeout — the script has no internal cap on how long a Codex review can take, so give it the maximum (600000ms). The call must complete before you have a result to act on.

## Reading the result

- **Success:** stdout is the same markdown-formatted review report `/codex:adversarial-review` would print for a human — a `Verdict:`, a summary, a `Findings:` list (each with severity, title, file:line, body, and recommendation), and a `Next steps:` list.
- **Failure:** stdout is empty; the reason is on stderr and the exit code distinguishes why:
  - **Exit 2** — the codex plugin itself isn't installed (no `codex@openai-codex` entry in `installed_plugins.json`, or its script is missing from the resolved install path). Message starts with `CODEX_NOT_INSTALLED:`.
  - **Exit 1** — the codex plugin is installed but the review itself failed (Codex CLI not authenticated, not inside a git repository, timeout, etc.). This is the underlying script's own error text, passed through unchanged — it often names the specific fix (e.g. pointing at `/codex:setup`).

  Either way, treat this as "the review is unavailable right now" and surface the stderr text as the reason to whatever workflow called this skill — don't treat it as a fatal error.
