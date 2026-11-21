#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
extensions_dir="$agent_dir/extensions"

# Pi installs no dependencies for a local package, and the manifest loads the rules extension from
# node_modules. The flags match Pi's dependency install for a Git package; ci keeps the lockfile.
(cd "$repo_root" && npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund)

node --input-type=module - "$repo_root" "$agent_dir" <<'JS'
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
const [repoRoot, agentDir] = process.argv.slice(2);
const settingsPath = join(agentDir, "settings.json");
const readSettings = () => existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {};
const source = entry => typeof entry === "string" ? entry : entry.source;

// Earlier setups registered a Git clone of this repo or its rendered subpackage.
const oldPaths = ["ai-rendered", "generated"].map(dir => join(repoRoot, dir, "pi/packages/mzizzi"));
const isOld = entry => /^git:github\.com\/mzizzi\/mzizzi-dotfiles(@|$)/.test(source(entry)) ||
  oldPaths.includes(resolve(agentDir, source(entry)));
const settings = readSettings();
if ((settings.packages ?? []).some(isOld)) {
  settings.packages = settings.packages.filter(entry => !isOld(entry));
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}
// pi/setup.sh rewrites the settings on a rebuild, which drops the Git entry but not its clone.
rmSync(join(agentDir, "git/github.com/mzizzi/mzizzi-dotfiles"), { recursive: true, force: true });

const result = spawnSync("pi", ["install", repoRoot], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`pi install failed (${result.signal ?? result.status}) for ${repoRoot}`);
// Pi can exit successfully without persisting settings.
const registered = (readSettings().packages ?? []).filter(entry => resolve(agentDir, source(entry)) === repoRoot);
if (registered.length !== 1) throw new Error(`Pi did not register ${repoRoot} once in ${settingsPath}`);
JS

mkdir -p "$extensions_dir"
for extension in "$repo_root/config/pi/extensions/"*; do
    if [[ -d "$extension" || "$extension" == *.js || "$extension" == *.ts ]]; then
        ln -sfnT "$extension" "$extensions_dir/${extension##*/}"
    fi
done
