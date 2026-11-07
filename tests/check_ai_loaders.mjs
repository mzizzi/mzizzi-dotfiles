import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "ai-loader-check-"));
try {
  const npmRoot = execFileSync("npm", ["root", "-g"], {
    encoding: "utf8",
  }).trim();
  const core = join(npmRoot, "@earendil-works/pi-coding-agent/dist/core");
  const { DefaultPackageManager } = await import(
    pathToFileURL(join(core, "package-manager.js"))
  );
  const { SettingsManager } = await import(
    pathToFileURL(join(core, "settings-manager.js"))
  );
  const { loadSkills } = await import(pathToFileURL(join(core, "skills.js")));
  const packagePath = join(repo, "generated/pi/packages/mzizzi");
  const manager = new DefaultPackageManager({
    cwd: temporary,
    agentDir: temporary,
    settingsManager: SettingsManager.inMemory({ packages: [packagePath] }),
  });
  const resources = await manager.resolve();
  assert.deepEqual(resources.installFailures ?? [], []);
  assert.ok(resources.skills.length > 0, "Pi package must expose skills");
  const loaded = loadSkills({
    cwd: temporary,
    agentDir: temporary,
    includeDefaults: false,
    skillPaths: resources.skills
      .filter((resource) => resource.enabled)
      .map((resource) => resource.path),
  });
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(
    loaded.skills.map((skill) => skill.name),
    ["mzizzi-renderer-example"],
  );
  console.log("Pi package and skill discovery passed.");

  const plugin = join(repo, "generated/claude/plugins/mzizzi");
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(temporary, "claude") };
  const validation = execFileSync(
    "claude",
    ["plugin", "validate", "--json", plugin],
    {
      cwd: temporary,
      env,
      encoding: "utf8",
    },
  );
  assert.equal(JSON.parse(validation).success, true);
  const inventory = execFileSync(
    "claude",
    ["--plugin-dir", plugin, "plugin", "details", "mzizzi"],
    {
      cwd: temporary,
      env,
      encoding: "utf8",
    },
  );
  assert.match(inventory, /renderer-example/);
  console.log("Claude plugin validation and skill inventory passed.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
