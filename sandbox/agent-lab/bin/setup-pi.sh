#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../../.." && pwd)
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
extensions_dir="$agent_dir/extensions"

uv run --no-project --with-requirements "$repo_root/ai-renderer/requirements.txt" \
    python "$repo_root/ai-renderer/render_ai.py" --target pi

node --input-type=module - "$agent_dir/settings.json" \
    "$repo_root/ai-rendered/pi/packages/mzizzi" "$repo_root/generated/pi/packages/mzizzi" <<'JS'
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const [settingsArg, packagePath, oldPackagePath] = process.argv.slice(2);
const settingsPath = resolve(settingsArg);
const settingsDir = dirname(settingsPath);

function readSettings() {
    try {
        return JSON.parse(readFileSync(settingsPath, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") return {};
        throw new Error(`Cannot read Pi settings at ${settingsPath}: ${error.message}`);
    }
}

function sourcePath(entry, settingsDir) {
    const source = typeof entry === "string" ? entry : entry?.source;
    return typeof source === "string" ? resolve(settingsDir, source) : undefined;
}

function runPi(args, cwd) {
    const result = spawnSync("pi", args, { cwd, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        throw new Error(`pi ${args[0]} failed (${result.signal ?? result.status}) for ${args[1]}`);
    }
}

const settings = readSettings();
const oldEntries = (settings.packages ?? []).filter(
    (entry) => sourcePath(entry, settingsDir) === oldPackagePath,
);
// Preflight all old entries before remove/install can discard resource restrictions.
for (const entry of oldEntries) {
    if (typeof entry === "object" && Object.keys(entry).some((key) => key !== "source")) {
        throw new Error(
            `Cannot migrate a restricted Pi package in ${settingsPath}. ` +
            `Change only that entry's source to ${packagePath}, preserving all other fields, then rerun setup.`,
        );
    }
}
if (oldEntries.length) {
    // Pi removes all entries with the same resolved package source.
    const entry = oldEntries[0];
    runPi(["remove", typeof entry === "string" ? entry : entry.source], settingsDir);
}
runPi(["install", packagePath], process.cwd());

// Pi can exit successfully without persisting settings.
const packages = readSettings().packages ?? [];
if (packages.some((entry) => sourcePath(entry, settingsDir) === oldPackagePath)) {
    throw new Error(`Pi did not remove ${oldPackagePath} from ${settingsPath}`);
}
if (!packages.some((entry) => sourcePath(entry, settingsDir) === packagePath)) {
    throw new Error(`Pi did not register ${packagePath} in ${settingsPath}`);
}
JS

mkdir -p "$extensions_dir"
for extension in "$repo_root/config/pi/extensions/"*; do
    if [[ -d "$extension" || "$extension" == *.js || "$extension" == *.ts ]]; then
        ln -sfnT "$extension" "$extensions_dir/${extension##*/}"
    fi
done
