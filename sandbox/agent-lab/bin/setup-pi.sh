#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
extensions_dir="$HOME/.pi/agent/extensions"

mkdir -p "$extensions_dir"
for extension in "$repo_root/config/pi/extensions/"*; do
    if [[ -d "$extension" || "$extension" == *.js || "$extension" == *.ts ]]; then
        ln -sfnT "$extension" "$extensions_dir/${extension##*/}"
    fi
done
