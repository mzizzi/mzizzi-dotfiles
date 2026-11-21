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
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  expectedMzizziAgents,
  expectedMzizziSkills,
} from "../../tests/support/mzizzi-inventory.mjs";
import {
  createSubagentsImporter,
  resolveSubagentsRoot,
} from "../../tests/support/pi-subagents-import.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const expectedPiSkills = expectedMzizziSkills(repo);
const temporary = mkdtempSync(join(tmpdir(), "ai-loader-check-"));
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const originalPiRoot = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
const models = JSON.parse(readFileSync(join(repo, "ai/models.json"), "utf8"));
const sol = `openai-codex/${models.sol}`;
const astra = `openai-codex/${models.astra}`;
const expectedAgents = [
  ["pragmatic-reviewer", astra, "medium"],
  ["standard", sol, "high"],
  ["complex", astra, "high"],
  ["simple", sol, "high"],
  ["delegator", sol, "high"],
  ["adversarial-reviewer", astra, "high"],
];
try {
  const npmRoot = execFileSync("npm", ["root", "-g"], {
    encoding: "utf8",
  }).trim();
  const piRoot = join(npmRoot, "@earendil-works/pi-coding-agent");
  const {
    DefaultPackageManager,
    SettingsManager,
    getAgentDir,
    loadSkills,
    parseFrontmatter: parseYamlFrontmatter,
  } = await import(pathToFileURL(join(piRoot, "dist/index.js")));
  const hostAgentDir = getAgentDir();
  const hostPackages = new DefaultPackageManager({
    cwd: temporary,
    agentDir: hostAgentDir,
    settingsManager: SettingsManager.create(temporary, hostAgentDir),
  });
  const importSubagents = createSubagentsImporter(resolveSubagentsRoot(hostPackages));
  const packagePath = join(repo, "ai-rendered/pi/packages/mzizzi");
  const agentDir = join(temporary, "agent");
  mkdirSync(agentDir);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [packagePath] }));
  const settingsManager = SettingsManager.create(temporary, agentDir);
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

  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT = piRoot;
  const { discoverAgents } = await importSubagents("src/agents/agents");
  const discovered = discoverAgents(temporary, "both", undefined, {
    globalNpmRoot: null,
  });
  assert.deepEqual(discovered.agentDiagnostics ?? [], []);
  const { parseFrontmatter } = await importSubagents("src/agents/frontmatter");
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
      ["standard", "delegator"].includes(name) ? true : undefined,
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

  const { resolveEffectiveAcceptance, formatAcceptancePrompt } = await importSubagents("src/runs/shared/acceptance");
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

  const { validateStructuredOutputValue } = await importSubagents("src/runs/shared/structured-output");
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
  for (const name of expectedPiSkills) {
    assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
  }
  for (const name of expectedMzizziAgents(repo, "claude", parseYamlFrontmatter)) {
    assert.ok(inventory.includes(name), `Claude plugin must expose ${name}`);
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
