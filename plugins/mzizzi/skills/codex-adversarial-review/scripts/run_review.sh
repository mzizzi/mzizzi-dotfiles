#!/usr/bin/env bash
# Run a Codex adversarial review by calling the codex plugin's companion
# script directly, bypassing the /codex:adversarial-review command (which
# ships with disable-model-invocation: true, so the model can't invoke it
# on its own — and hand-editing that flag on the vendored command file gets
# wiped on every plugin update).
#
# Usage: run_review.sh "<focus/scope text, same as /codex:adversarial-review>"
#
# Resolves the codex plugin's current install location from Claude Code's
# own installed_plugins.json (rewritten on every plugin update, so this
# stays correct without any manual patching) and invokes codex-companion.mjs
# the same way the command's own foreground flow does. Exits 2 if the codex
# plugin itself isn't installed; otherwise exits with the underlying
# script's own exit code (normally 1) and error text for a review that
# fails at runtime (auth, missing CLI, not a git repo, etc).
#
# node's own stderr is full of progress noise ([codex] Running command...,
# deprecation warnings) even on a successful run. That's discarded on
# success so stdout is exactly the rendered review report and nothing else
# — it's only surfaced (to our own stderr) when the review actually fails,
# where it's the useful diagnostic.
set -euo pipefail

focus_args="${1:-}"
installed_json="$HOME/.claude/plugins/installed_plugins.json"

install_path=$(jq -r '.plugins["codex@openai-codex"][0].installPath // empty' "$installed_json" 2>/dev/null || true)
if [ -z "$install_path" ]; then
  echo "CODEX_NOT_INSTALLED: the openai-codex plugin isn't installed (no codex@openai-codex entry in $installed_json)." >&2
  exit 2
fi

script="$install_path/scripts/codex-companion.mjs"
if [ ! -f "$script" ]; then
  echo "CODEX_NOT_INSTALLED: codex-companion.mjs not found at expected path: $script" >&2
  exit 2
fi

tmp_err="${TMPDIR:-/tmp}/codex-adversarial-review.$$.stderr"
tmp_out="${TMPDIR:-/tmp}/codex-adversarial-review.$$.stdout"
trap 'rm -f "$tmp_err" "$tmp_out"' EXIT

# No `if !` or `||` guard in front of this call: both reset $? and would report
# every failure as success. stdout is buffered rather than streamed so that a
# non-zero exit really does mean empty stdout — the companion can render a
# partial report before it settles on a failing status.
set +e
node "$script" adversarial-review "$focus_args" >"$tmp_out" 2>"$tmp_err"
status=$?
set -e

if [ "$status" -ne 0 ]; then
  cat "$tmp_err" >&2
  exit "$status"
fi

cat "$tmp_out"
