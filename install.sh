#!/usr/bin/env bash
# Install (or update) the mzizzi Claude Code plugin marketplace and plugin.
# Idempotent: safe to re-run any time to pull the latest version.
set -euo pipefail

MARKETPLACE="mzizzi"
PLUGIN="mzizzi"
REPO="mzizzi/mzizzi-dotfiles"

for cmd in claude jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: required command '$cmd' not found in PATH" >&2
    exit 1
  fi
done

if claude plugin marketplace list --json | jq -e --arg m "$MARKETPLACE" 'any(.[]; .name == $m)' >/dev/null; then
  echo "Marketplace '$MARKETPLACE' already configured — updating from source..."
  claude plugin marketplace update "$MARKETPLACE"
else
  echo "Adding marketplace '$MARKETPLACE' from github.com/$REPO..."
  claude plugin marketplace add "$REPO"
fi

if claude plugin list --json | jq -e --arg id "$PLUGIN@$MARKETPLACE" 'any(.[]; .id == $id)' >/dev/null; then
  echo "Plugin '$PLUGIN@$MARKETPLACE' already installed — updating..."
  claude plugin update "$PLUGIN@$MARKETPLACE"
else
  echo "Installing plugin '$PLUGIN@$MARKETPLACE'..."
  claude plugin install "$PLUGIN@$MARKETPLACE"
fi

echo "Done. Restart Claude Code sessions to pick up the changes."
