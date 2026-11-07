#!/usr/bin/env bash
# Configure pi for the current user: install pi/settings.json and append an output style to its
# system prompt. Usage: setup.sh OUTPUT_STYLE_MD
# Shared by the agent-lab kit and the SimRacing devcontainer.
set -euo pipefail

style=$1
agent_dir="$HOME/.pi/agent"
mkdir -p "$agent_dir"

# The whole settings file is managed here, so package versions stay pinned. pi installs missing
# packages on startup but only warns when one fails; installing them here fails setup instead and
# keeps the install off the first session. pi has no command that installs from settings alone,
# and `pi install` leaves the file unchanged for a source it already lists.
settings="$(dirname "$0")/settings.json"
cp "$settings" "$agent_dir/settings.json"
jq -r '.packages[]' "$settings" | xargs -n 1 pi install

# pi's counterpart to a Claude output style: the style's body, without its frontmatter, appended
# to every pi system prompt. tr drops CRs from a Windows checkout; sed deletes from the opening
# `---` through the closing one.
tr -d '\r' <"$style" | sed '1,/^---$/d' >"$agent_dir/APPEND_SYSTEM.md"
test -s "$agent_dir/APPEND_SYSTEM.md"
