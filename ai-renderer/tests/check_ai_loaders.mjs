import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "ai-loader-check-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalPiRoot = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
const expectedClaudeSkills = readdirSync(
  join(repo, "plugins/mzizzi/skills"),
).sort();
const renameReview = (name) => name === "codex-adversarial-review" ? "adversarial-review" : name;
const expectedPiSkills = expectedClaudeSkills.map(renameReview).sort();
const expectedAgents = [
  ["pragmatic-reviewer", "chatgpt/gpt-6-astra", "medium"],
  ["standard", "chatgpt/gpt-6.1-sol", "high"],
  ["complex", "chatgpt/gpt-6-astra", "medium"],
  ["simple", "chatgpt/gpt-6.1-sol", "medium"],
  ["delegator", "chatgpt/gpt-6.1-sol", "high"],
  ["adversarial-reviewer", "chatgpt/gpt-6-astra", "high"],
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
  const packagePath = join(repo, "ai-rendered/pi/packages/mzizzi");
  const agentDir = join(temporary, "agent string");
  const existingPackage = join(temporary, "existing-package");
  const oldPackagePath = join(repo, "generated/pi/packages/mzizzi");
  const setupScript = join(repo, "sandbox/agent-lab/bin/setup-pi.sh");
  mkdirSync(existingPackage);
  writeFileSync(
    join(existingPackage, "package.json"),
    JSON.stringify({ name: "existing-package", pi: {} }),
  );
  const initialSettings = {
    defaultProvider: "chatgpt",
    defaultModel: "gpt-6.1-sol",
    defaultThinkingLevel: "high",
  };
  for (const kind of ["string", "object", "relative string", "relative object", "duplicates"]) {
    const profile = join(temporary, `agent ${kind}`);
    mkdirSync(profile);
    const source = kind.startsWith("relative") ? relative(profile, oldPackagePath) : oldPackagePath;
    const oldEntry = kind.endsWith("object") ? { source } : source;
    const settingsPath = join(profile, "settings.json");
    const oldEntries = kind === "duplicates" ? [oldEntry, { source: relative(profile, oldPackagePath) }] : [oldEntry];
    writeFileSync(settingsPath, JSON.stringify({
      ...initialSettings, packages: [existingPackage, ...oldEntries],
    }));
    for (let boot = 0; boot < 2; boot++) {
      execFileSync("bash", [setupScript], {
        cwd: temporary,
        env: { ...process.env, PI_CODING_AGENT_DIR: profile },
        stdio: "pipe",
      });
    }
    const saved = JSON.parse(readFileSync(settingsPath, "utf8"));
    assert.deepEqual({
      ...saved, packages: saved.packages.map((source) => resolve(profile, source)),
    }, {
      ...initialSettings, packages: [existingPackage, packagePath],
    });
    const profileSettings = SettingsManager.create(temporary, profile);
    const profileManager = new DefaultPackageManager({ cwd: temporary, agentDir: profile, settingsManager: profileSettings });
    const profileResources = await profileManager.resolve();
    assert.deepEqual(profileResources.installFailures ?? [], []);
    const profileSkills = loadSkills({
      cwd: temporary, agentDir: profile, includeDefaults: false,
      skillPaths: profileResources.skills.filter((resource) => resource.enabled).map((resource) => resource.path),
    });
    assert.deepEqual(profileSkills.diagnostics, []);
    assert.deepEqual(profileSkills.skills.map((skill) => skill.name).sort(), expectedPiSkills);
  }
  for (const mixed of [false, true]) {
    const profile = join(temporary, `restricted ${mixed}`);
    mkdirSync(profile);
    const settingsPath = join(profile, "settings.json");
    const original = JSON.stringify({
      ...initialSettings,
      packages: [existingPackage, ...(mixed ? [oldPackagePath] : []), { source: oldPackagePath, skills: [] }],
    }, null, 2) + "\n";
    writeFileSync(settingsPath, original);
    const stopped = spawnSync("bash", [setupScript], {
      cwd: temporary,
      env: { ...process.env, PI_CODING_AGENT_DIR: profile },
      encoding: "utf8",
    });
    assert.equal(stopped.status, 1, stopped.stdout + stopped.stderr);
    assert.match(stopped.stderr, /Change only that entry's source/);
    assert.ok(stopped.stderr.includes(settingsPath));
    assert.ok(stopped.stderr.includes(packagePath));
    assert.equal(readFileSync(settingsPath, "utf8"), original);
  }
  console.log("Real Pi CLI setup migration, repeated starts, discovery, and restricted-object preflight passed.");
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
    if (name === "adversarial-reviewer") {
      assert.deepEqual(agent.tools, ["read", "grep", "find", "ls", "bash"]);
      assert.equal(agent.acceptanceRole, "read-only");
      assert.equal(agent.inheritSkills, false);
      assert.match(agent.systemPrompt, /structured_output/);
    } else {
      assert.match(agent.systemPrompt, /the `development-preferences` skill/);
    }
  }
  console.log("Pi agent package discovery passed.");

  const { resolveEffectiveAcceptance, formatAcceptancePrompt } = await import(
    pathToFileURL(join(subagents, "src/runs/shared/acceptance.js"))
  );
  const standard = discovered.agents.find((agent) => agent.name === "mzizzi.standard");
  const inferred = resolveEffectiveAcceptance({ acceptanceRole: standard.acceptanceRole, async: true });
  assert.equal(inferred.level, "attested");
  assert.match(formatAcceptancePrompt(inferred), /structured acceptance report/);
  const qualityPolicy = { level: "none", reason: "read-only quality review" };
  const explicit = resolveEffectiveAcceptance({ acceptanceRole: standard.acceptanceRole, async: true, explicit: qualityPolicy });
  assert.equal(explicit.level, "none");
  assert.equal(formatAcceptancePrompt(explicit), "");
  assert.match(
    readFileSync(join(packagePath, "skills/fix-quality/SKILL.md"), "utf8"),
    /acceptance: \{ level: "none", reason: "read-only quality review" \}/,
  );
  console.log("Pi read-only quality review acceptance policy passed.");

  process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = join(npmRoot, "@earendil-works/pi-coding-agent");
  const { validateStructuredOutputValue } = await import(
    pathToFileURL(join(subagents, "src/runs/shared/structured-output.js"))
  );
  const { outputSchema } = await import(
    pathToFileURL(join(packagePath, "skills/adversarial-review/scripts/lib/review.mjs"))
  );
  const report = { verdict: "approve", summary: "No material findings.", findings: [], next_steps: [] };
  for (const outcome of [
    { status: "complete", report, reason: null },
    { status: "unavailable", report: null, reason: "Cancelled" },
  ]) {
    const validation = await validateStructuredOutputValue(outputSchema, outcome);
    assert.notEqual(validation.status, "invalid", JSON.stringify(validation));
  }
  const malformed = await validateStructuredOutputValue(outputSchema, {
    status: "complete", report: { ...report, findings: [{}] }, reason: null,
  });
  assert.equal(malformed.status, "invalid");
  console.log("Pi structured review outcome schema passed.");

  const plugin = join(repo, "ai-rendered/claude/plugins/mzizzi");
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
  for (const name of expectedClaudeSkills.map(renameReview)) {
    assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
  }
  for (const [name] of expectedAgents) {
    if (name !== "adversarial-reviewer") {
      assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
    }
  }
  assert.ok(!inventory.includes("codex-adversarial-review"));
  assert.ok(!readdirSync(join(plugin, "agents")).includes("adversarial-reviewer.md"));
  console.log(
    "Claude plugin validation, skill inventory, and agent inventory passed.",
  );
} finally {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  if (originalPiRoot === undefined) delete process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
  else process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = originalPiRoot;
  rmSync(temporary, { recursive: true, force: true });
}
