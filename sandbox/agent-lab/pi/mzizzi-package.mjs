import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = "github.com/mzizzi/mzizzi-dotfiles";
const revision = "7fde4e6f964f524ba65f61d9e5276e9c0f7e27fa";
export const packageSource = `git:${repo}@${revision}`;
const source = entry => typeof entry === "string" ? entry : entry.source;

function runPi(command, spec, cwd) {
  const result = spawnSync("pi", [command, spec], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pi ${command} failed (${result.signal ?? result.status}) for ${spec}`);
}

function setup(command, repoRoot, agentDir, baseSettings) {
  const settings = join(agentDir, "settings.json");
  const snapshot = existsSync(settings) ? readFileSync(settings) : null;
  const entries = snapshot ? JSON.parse(snapshot).packages ?? [] : [];
  const readEntries = () => JSON.parse(readFileSync(settings, "utf8")).packages ?? [];
  const legacy = ["ai-rendered", "generated"].map(dir => join(repoRoot, dir, "pi/packages/mzizzi"));
  const isLegacy = entry => legacy.includes(resolve(agentDir, source(entry)));
  const owned = entries.filter(entry => isLegacy(entry) || source(entry) === packageSource);
  for (const entry of owned) {
    if (typeof entry === "object" && Object.keys(entry).some(key => key !== "source")) {
      throw new Error(`Review restricted mzizzi package ${entry.source} in ${settings} before switching to ${packageSource}.`);
    }
  }
  if (entries.some(entry => /^(?:git:)?(?:https:\/\/)?github\.com\/mzizzi\/mzizzi-dotfiles(?:\.git)?(?:@.*)?$/.test(source(entry)) && source(entry) !== packageSource)) {
    throw new Error(`Review the existing mzizzi Git ref in ${settings} before installing ${packageSource}.`);
  }

  mkdirSync(agentDir, { recursive: true });
  if (command === "base") {
    // Devcontainer rebuilds apply base settings before the startup migration runs.
    const base = JSON.parse(readFileSync(baseSettings, "utf8"));
    base.packages.push(...owned);
    writeFileSync(settings, JSON.stringify(base, null, 2) + "\n");
    return;
  }
  if (command !== "install") throw new Error(`Unknown setup command: ${command}`);
  const clone = join(agentDir, "git", repo);
  const ready = () => existsSync(join(clone, "node_modules/pi-code/extensions/claude-rules.ts")) &&
    spawnSync("git", ["rev-parse", "HEAD"], { cwd: clone, encoding: "utf8" }).stdout?.trim() === revision;
  const registered = list => list.some(e => source(e) === packageSource);
  const old = owned.filter(isLegacy);
  if (!old.length && registered(entries) && ready()) return;
  try {
    if (!registered(entries) || !ready()) runPi("install", packageSource, agentDir);
    if (!existsSync(settings) || !registered(readEntries())) throw new Error(`Pi did not register ${packageSource} in ${settings}`);
    if (!ready()) throw new Error(`Incomplete mzizzi install at ${clone}`);
    for (const path of new Set(old.map(entry => resolve(agentDir, source(entry))))) runPi("remove", path, agentDir);
    const saved = readEntries();
    if (saved.some(isLegacy)) throw new Error(`Pi did not remove the old mzizzi registration from ${settings}`);
    if (!registered(saved)) throw new Error(`Pi did not retain ${packageSource} in ${settings}`);
  } catch (error) {
    // A failed removal must not leave the same agents registered from two packages.
    if (snapshot === null) rmSync(settings, { force: true });
    else writeFileSync(settings, snapshot);
    throw error;
  }
}

if (import.meta.main) setup(...process.argv.slice(2));
