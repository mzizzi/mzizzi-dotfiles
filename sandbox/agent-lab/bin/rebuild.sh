#!/usr/bin/env bash
# Recreate the agent-lab sandbox from the current kit and open its network.
# The kit allowlist stays in place; bin/network-restrict.ps1 closes the network again.
set -euo pipefail

name=agent-lab
repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
state_dir="$HOME/.sandbox-state/$name"

cd "$repo_root"
mkdir -p "$state_dir"

if sbx ls | awk 'NR > 1 { print $1 }' | grep -qx "$name"; then
    sbx rm --force "$name"
fi
sbx create --clone --skills off --name "$name" ./sandbox/agent-lab . "$state_dir"
sbx policy allow network --sandbox "$name" '**'
