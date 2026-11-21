#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
extensions_dir="$agent_dir/extensions"

node "$repo_root/sandbox/agent-lab/pi/mzizzi-package.mjs" install "$repo_root" "$agent_dir"

mkdir -p "$extensions_dir"
for extension in "$repo_root/config/pi/extensions/"*; do
    if [[ -d "$extension" || "$extension" == *.js || "$extension" == *.ts ]]; then
        ln -sfnT "$extension" "$extensions_dir/${extension##*/}"
    fi
done
