#!/usr/bin/env bash
# Configure pi for the current user: install Pi and subagent settings and pinned packages.
# Usage: setup.sh
# Shared by the agent-lab kit and the SimRacing devcontainer.
set -euo pipefail

agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
mkdir -p "$agent_dir"

# The whole settings file is managed here, so package versions stay pinned. pi installs missing
# packages on startup but only warns when one fails; installing them here fails setup instead and
# keeps the install off the first session. pi has no command that installs from settings alone,
# and `pi install` leaves the file unchanged for a source it already lists.
setup_dir=$(cd "$(dirname "$0")" && pwd)
settings="$setup_dir/settings.json"
repo_root=$(cd "$setup_dir/../../.." && pwd)
if [[ "$setup_dir" == /opt/pi-setup ]]; then repo_root="${WORKSPACE_DIR:-$PWD}"; fi
node "$setup_dir/mzizzi-package.mjs" base "$repo_root" "$agent_dir" "$settings"
mkdir -p "$agent_dir/extensions/subagent"
cp "$(dirname "$0")/subagents.json" "$agent_dir/extensions/subagent/config.json"
jq -r '.packages[]' "$settings" | xargs -n 1 pi install
