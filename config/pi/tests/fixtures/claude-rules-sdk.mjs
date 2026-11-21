import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  expectedMzizziAgents,
  expectedMzizziSkills,
} from "../../../../tests/support/mzizzi-inventory.mjs";
import { createSubagentsImporter } from "../../../../tests/support/pi-subagents-import.mjs";
import { modelId } from "./claude-rules-provider.mjs";

const hostRoot = process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
const [mode, source, subagentsSource] = process.argv.slice(2);
const host = await import(pathToFileURL(join(hostRoot, "dist/index.js")));
const cwd = process.cwd();
const agentDir = host.getAgentDir();
const inside = (path, root) => path.startsWith(root + sep);

async function checkInventory() {
  const settingsManager = host.SettingsManager.create(cwd, agentDir);
  const manager = new host.DefaultPackageManager({
    cwd,
    agentDir,
    settingsManager,
  });
  const installed = manager.getInstalledPath(source, "user");
  const subagents = manager.getInstalledPath(subagentsSource, "user");
  const head = (cwd) =>
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
    }).trim();
  assert.ok(
    installed && inside(installed, agentDir),
    "expected a package clone inside the disposable profile",
  );
  assert.ok(
    subagents && inside(subagents, agentDir),
    "expected pi-subagents inside the disposable profile",
  );
  assert.equal(head(installed), source.split("@").at(-1));
  assert.equal(head(subagents), subagentsSource.split("@").at(-1));
  const piCode = join(installed, "node_modules/pi-code");
  const pin = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))
    .dependencies?.["pi-code"];
  const { version } = JSON.parse(
    readFileSync(join(piCode, "package.json"), "utf8"),
  );
  assert.ok(version, "Installed pi-code must declare its version");
  assert.equal(
    version,
    pin,
    "The candidate must pin the installed pi-code version",
  );

  const resources = new host.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
  });
  await resources.reload();
  const { extensions, errors } = resources.getExtensions();
  assert.deepEqual(errors, []);
  assert.deepEqual(
    extensions
      .map(({ resolvedPath }) => resolvedPath)
      .filter((path) => inside(path, installed)),
    [join(piCode, "extensions/claude-rules.ts")],
  );
  assert.ok(
    extensions.some(
      ({ resolvedPath }) => resolvedPath === join(subagents, "index.ts"),
    ),
    "managed pi-subagents extension did not load",
  );
  const { skills, diagnostics } = resources.getSkills();
  assert.deepEqual(diagnostics, []);
  const rendered = join(installed, "ai-rendered/pi/packages/mzizzi");
  const skillsRoot = join(rendered, "skills");
  assert.deepEqual(
    skills
      .filter(({ filePath }) => inside(filePath, skillsRoot))
      .map(({ name }) => name)
      .sort(),
    expectedMzizziSkills(installed),
  );

  const importSubagents = createSubagentsImporter(subagents);
  const { discoverAgents } = await importSubagents("src/agents/agents");
  const discovered = discoverAgents(cwd, "both", undefined, {
    globalNpmRoot: null,
  });
  assert.deepEqual(discovered.agentDiagnostics ?? [], []);
  const agents = discovered.agents.filter(({ name }) =>
    name.startsWith("mzizzi."),
  );
  assert.deepEqual(
    agents.map(({ name }) => name).sort(),
    expectedMzizziAgents(installed, "pi", host.parseFrontmatter).map(
      (name) => `mzizzi.${name}`,
    ),
  );
  const agentsRoot = join(rendered, "agents");
  for (const agent of agents) {
    assert.equal(agent.source, "package");
    assert.ok(
      inside(agent.filePath, agentsRoot),
      `${agent.name}: ${agent.filePath}`,
    );
  }
}

async function checkSession(mode, trust) {
  assert.ok(
    ["approve", "deny", "headless"].includes(mode),
    `Unknown SDK scenario: ${mode}`,
  );
  const approved = mode === "headless" ? null : mode === "approve";
  assert.equal(trust.get(cwd), null);
  assert.equal(host.hasTrustRequiringProjectResources(cwd), false);
  const modelRuntime = await host.ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const provider = fileURLToPath(
    new URL("./claude-rules-provider.mjs", import.meta.url),
  );
  const services = await host.createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime,
    resourceLoaderOptions: { additionalExtensionPaths: [provider] },
  });
  assert.deepEqual(services.diagnostics, []);
  assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
  const model = modelRuntime.getModel(...modelId.split("/"));
  assert.ok(model, "Local scripted provider must be available");
  const runtime = await host.createAgentSessionRuntime(
    async ({ sessionManager }) => ({
      ...(await host.createAgentSessionFromServices({
        services,
        model,
        thinkingLevel: "off",
        tools: ["read"],
        sessionManager,
      })),
      services,
      diagnostics: [],
    }),
    { cwd, agentDir, sessionManager: host.SessionManager.inMemory(cwd) },
  );
  const { session } = runtime;
  const confirmations = [];
  const errors = [];
  try {
    const binding =
      approved === null
        ? { mode: "print" }
        : {
            mode: "tui",
            uiContext: {
              async confirm(title, body) {
                confirmations.push({ title, body });
                return approved;
              },
              notify() {},
              setWidget() {},
              setStatus() {},
            },
          };
    await session.bindExtensions({
      ...binding,
      onError: (error) => errors.push(error),
    });
    assert.deepEqual(errors, []);
    if (approved !== null) {
      assert.equal(confirmations.length, 1, JSON.stringify(confirmations));
      assert.equal(confirmations[0].title, "Trust this project?");
      assert.ok(confirmations[0].body.includes(cwd));
      assert.match(confirmations[0].body, /Claude Code configuration/);
    }
    assert.equal(
      trust.get(cwd),
      approved,
      "loader must persist only an actual interactive decision",
    );
    await session.prompt("Run the scripted rules reads.");
    await session.waitForIdle();
    assert.equal(
      trust.get(cwd),
      approved,
      "reading a file must not change trust",
    );
  } finally {
    await runtime.dispose();
  }
  assert.deepEqual(errors, []);
}

if (mode === "inventory") {
  await checkInventory();
} else {
  const trust = new host.ProjectTrustStore(agentDir);
  if (mode === "undecided") assert.equal(trust.get(cwd), null);
  else await checkSession(mode, trust);
}
