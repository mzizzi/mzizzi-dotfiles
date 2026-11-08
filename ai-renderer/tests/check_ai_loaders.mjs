import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "ai-loader-check-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const expectedClaudeSkills = readdirSync(
  join(repo, "plugins/mzizzi/skills"),
).sort();
const expectedPiSkills = expectedClaudeSkills;
const expectedAgents = [
  ["pragmatic-reviewer", "chatgpt/gpt-6-astra", "medium"],
  ["standard", "chatgpt/gpt-6.1-sol", "high"],
  ["complex", "chatgpt/gpt-6-astra", "medium"],
  ["simple", "chatgpt/gpt-6.1-sol", "medium"],
  ["delegator", "chatgpt/gpt-6.1-sol", "high"],
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
  const agentDir = join(temporary, "agent");
  const existingPackage = join(temporary, "existing-package");
  mkdirSync(agentDir);
  mkdirSync(existingPackage);
  writeFileSync(
    join(existingPackage, "package.json"),
    JSON.stringify({ name: "existing-package", pi: {} }),
  );
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "chatgpt",
      defaultModel: "gpt-6.1-sol",
      defaultThinkingLevel: "high",
      packages: [existingPackage],
    }),
  );
  for (let boot = 0; boot < 2; boot++) {
    execFileSync("pi", ["install", packagePath], {
      cwd: temporary,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: "pipe",
    });
  }
  const settingsManager = SettingsManager.create(temporary, agentDir);
  assert.deepEqual(
    settingsManager.getPackages().map((source) => resolve(agentDir, source)),
    [existingPackage, packagePath],
  );
  assert.equal(settingsManager.getDefaultProvider(), "chatgpt");
  assert.equal(settingsManager.getDefaultModel(), "gpt-6.1-sol");
  assert.equal(settingsManager.getDefaultThinkingLevel(), "high");
  const manager = new DefaultPackageManager({
    cwd: temporary,
    agentDir,
    settingsManager,
  });
  const resources = await manager.resolve();
  assert.deepEqual(resources.installFailures ?? [], []);
  assert.ok(resources.skills.length > 0, "Pi package must expose skills");
  const loaded = loadSkills({
    cwd: temporary,
    agentDir,
    includeDefaults: false,
    skillPaths: resources.skills
      .filter((resource) => resource.enabled)
      .map((resource) => resource.path),
  });
  assert.deepEqual(loaded.diagnostics, []);
  assert.deepEqual(
    loaded.skills.map((skill) => skill.name).sort(),
    expectedPiSkills,
  );
  console.log("Pi package and skill discovery passed.");

  const { getAgentDir } = await import(
    pathToFileURL(join(core, "../config.js"))
  );
  const subagents = join(getAgentDir(), "npm/node_modules/pi-subagents");
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const { discoverAgents } = await import(
    pathToFileURL(join(subagents, "src/agents/agents.js"))
  );
  const discovered = discoverAgents(temporary, "both", undefined, {
    globalNpmRoot: null,
  });
  assert.deepEqual(discovered.agentDiagnostics ?? [], []);
  const { parseFrontmatter } = await import(
    pathToFileURL(join(subagents, "src/agents/frontmatter.js"))
  );
  for (const [name, model, thinking] of expectedAgents) {
    const agent = discovered.agents.find(
      (agent) => agent.name === `mzizzi.${name}`,
    );
    assert.ok(agent, `Pi package must expose mzizzi.${name}`);
    assert.equal(agent.source, "package");
    const source = readFileSync(
      join(repo, `ai/mzizzi/agents/${name}.md.j2`),
      "utf8",
    );
    assert.equal(
      agent.description,
      parseFrontmatter(source).frontmatter.description,
    );
    assert.equal(agent.advertise, true);
    assert.equal(agent.model, model);
    assert.equal(agent.thinking, thinking);
    assert.equal(
      agent.allowNestedSubagents,
      name === "delegator" ? true : undefined,
    );
    assert.match(agent.systemPrompt, /the `development-preferences` skill/);
  }
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
  for (const name of expectedClaudeSkills) {
    assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
  }
  for (const [name] of expectedAgents) {
    assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
  }
  console.log(
    "Claude plugin validation, skill inventory, and agent inventory passed.",
  );
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(temporary, { recursive: true, force: true });
}
