#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
extensions_dir="$agent_dir/extensions"

uv run --no-project --with-requirements "$repo_root/ai-renderer/requirements.txt" \
    python "$repo_root/ai-renderer/render_ai.py" --target pi
pi install "$repo_root/generated/pi/packages/mzizzi"

# Pi can exit successfully without saving a package when its settings are malformed.
node --input-type=module - "$agent_dir/settings.json" "$repo_root/generated/pi/packages/mzizzi" <<'JS'
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const [settingsPath, packagePath] = process.argv.slice(2);
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const registered = settings.packages?.some((entry) => {
    const source = typeof entry === "string" ? entry : entry?.source;
    return typeof source === "string" && resolve(dirname(settingsPath), source) === packagePath;
});
if (!registered) throw new Error(`Pi did not register ${packagePath} in ${settingsPath}`);
JS

mkdir -p "$extensions_dir"
for extension in "$repo_root/config/pi/extensions/"*; do
    if [[ -d "$extension" || "$extension" == *.js || "$extension" == *.ts ]]; then
        ln -sfnT "$extension" "$extensions_dir/${extension##*/}"
    fi
done
