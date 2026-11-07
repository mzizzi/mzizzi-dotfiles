import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "ai-loader-check-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const expectedSkills = [
  "create-plan-dir",
  "development-preferences",
  "renderer-example",
];
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
    loaded.skills.map((skill) => skill.name).sort(),
    expectedSkills,
  );
  console.log("Pi package and skill discovery passed.");

  const { getAgentDir } = await import(
    pathToFileURL(join(core, "../config.js"))
  );
  const subagents = join(getAgentDir(), "npm/node_modules/pi-subagents");
  process.env.PI_CODING_AGENT_DIR = temporary;
  writeFileSync(
    join(temporary, "settings.json"),
    JSON.stringify({ packages: [packagePath] }),
  );
  const { discoverAgents } = await import(
    pathToFileURL(join(subagents, "src/agents/agents.js"))
  );
  const discovered = discoverAgents(temporary, "both", undefined, {
    globalNpmRoot: null,
  });
  assert.deepEqual(discovered.agentDiagnostics ?? [], []);
  const agent = discovered.agents.find(
    (agent) => agent.name === "mzizzi.pragmatic-reviewer",
  );
  assert.ok(agent, "Pi package must expose the qualified reviewer");
  assert.equal(agent.source, "package");
  const { parseFrontmatter } = await import(
    pathToFileURL(join(subagents, "src/agents/frontmatter.js"))
  );
  const source = readFileSync(
    join(repo, "ai/mzizzi/agents/pragmatic-reviewer.md.j2"),
    "utf8",
  );
  assert.equal(
    agent.description,
    parseFrontmatter(source).frontmatter.description,
  );
  assert.equal(agent.advertise, true);
  assert.equal(agent.model, "chatgpt/gpt-6-astra");
  assert.equal(agent.thinking, "medium");
  assert.match(agent.systemPrompt, /the `development-preferences` skill/);
  console.log("Pi agent package discovery passed.");

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
  for (const name of expectedSkills) {
    assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
  }
  assert.ok(
    inventory.includes("pragmatic-reviewer"),
    "Claude plugin must expose the reviewer",
  );
  console.log(
    "Claude plugin validation, skill inventory, and agent inventory passed.",
  );
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(temporary, { recursive: true, force: true });
}
