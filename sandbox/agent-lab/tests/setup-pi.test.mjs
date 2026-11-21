import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import attentionControl from "../../../config/pi/extensions/attention-control/index.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const setupScriptPath = "sandbox/agent-lab/bin/setup-pi.sh";
const dependencyInputs = ["package.json", "package-lock.json"];
const npmCi = "ci --omit=dev --legacy-peer-deps --no-audit --no-fund";

// Setup installs into the checkout it runs from, so each test runs a copy that links the real config.
const checkoutOf = (home) => join(home, "checkout with spaces");
const extensionOf = (home, name) => join(checkoutOf(home), "config/pi/extensions", name);

function temporaryHome(t) {
  const home = mkdtempSync(join(tmpdir(), "setup-pi-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  copySetup(checkoutOf(home));
  symlinkSync(join(repoRoot, "config"), join(checkoutOf(home), "config"));
  const bin = join(home, "bin");
  mkdirSync(bin);
  // Like npm ci, deletes node_modules first and leaves a partial tree on failure.
  writeFileSync(
    join(bin, "npm"),
    '#!/bin/sh\nprintf "%s %s\\n" "$PWD" "$*" >> "$HOME/npm-calls.log"\n' +
      'rm -rf node_modules && mkdir node_modules\nexit "${NPM_EXIT_STATUS:-0}"\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "pi"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.HOME, "pi-installs.log"), args.join(" ") + "\\n");
if (process.env.PI_EXIT_STATUS) process.exit(Number(process.env.PI_EXIT_STATUS));
if (args[0] !== "install") process.exit(2);
if (process.env.PI_SKIP_REGISTRATION || !path.isAbsolute(args[1])) process.exit(0);
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME, ".pi/agent");
fs.mkdirSync(agentDir, {recursive: true});
const settingsPath = path.join(agentDir, "settings.json");
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
settings.packages ??= [];
const source = (entry) => typeof entry === "string" ? entry : entry.source;
if (settings.packages.some((entry) => path.resolve(agentDir, source(entry)) === args[1])) process.exit(0);
settings.packages.push(path.relative(agentDir, args[1]));
fs.writeFileSync(settingsPath, JSON.stringify(settings));
`,
    { mode: 0o755 },
  );
  return home;
}

function copySetup(checkout) {
  const script = join(checkout, setupScriptPath);
  mkdirSync(dirname(script), { recursive: true });
  writeFileSync(script, readFileSync(join(repoRoot, setupScriptPath)));
  for (const name of dependencyInputs) {
    writeFileSync(join(checkout, name), readFileSync(join(repoRoot, name)));
  }
  return script;
}

const packagesOf = (agentDir) => JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages;
const logLines = (home, name) => readFileSync(join(home, name), "utf8").trim().split("\n");
const stampOf = (checkout) => join(checkout, "node_modules/.setup-pi.sha256");

function setup(home, { script = join(checkoutOf(home), setupScriptPath), env = {} } = {}) {
  execFileSync("bash", [script], {
    cwd: tmpdir(),
    env: {
      ...process.env,
      HOME: home,
      PI_CODING_AGENT_DIR: join(home, ".pi/agent"),
      PATH: `${home}/bin:${process.env.PATH}`,
      ...env,
    },
    stdio: "pipe",
  });
}

test("installs dependencies once and registers the checkout once across repeated boots", (t) => {
  const home = temporaryHome(t);
  const checkout = checkoutOf(home);
  const agentDir = join(home, ".pi/agent");
  setup(home);
  setup(home);
  assert.deepEqual(packagesOf(agentDir), [relative(agentDir, checkout)]);
  assert.deepEqual(logLines(home, "npm-calls.log"), [`${checkout} ${npmCi}`]);
});

for (const name of dependencyInputs) {
  test(`reinstalls dependencies after a ${name} change`, (t) => {
    const home = temporaryHome(t);
    setup(home);
    appendFileSync(join(checkoutOf(home), name), "\n");
    setup(home);
    setup(home);
    assert.equal(logLines(home, "npm-calls.log").length, 2);
  });
}

test("reinstalls dependencies when node_modules is missing", (t) => {
  const home = temporaryHome(t);
  setup(home);
  rmSync(join(checkoutOf(home), "node_modules"), { recursive: true });
  setup(home);
  assert.equal(logLines(home, "npm-calls.log").length, 2);
});

test("dependency install failure stops setup before registration and writes no stamp", (t) => {
  const home = temporaryHome(t);
  assert.throws(() => setup(home, { env: { NPM_EXIT_STATUS: "1" } }));
  assert.throws(() => readFileSync(join(home, "pi-installs.log")), { code: "ENOENT" });
  assert.equal(existsSync(stampOf(checkoutOf(home))), false);
});

test("reports package registration failure instead of completing setup", (t) => {
  const home = temporaryHome(t);
  assert.throws(() => setup(home, { env: { PI_EXIT_STATUS: "1" } }));
  assert.throws(
    () => readlinkSync(join(home, ".pi/agent/extensions/worktree")),
    { code: "ENOENT" },
  );
});

test("rejects a successful CLI exit without persisted registration", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, ".pi/agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), "{}\n");
  assert.throws(
    () => setup(home, { env: { PI_SKIP_REGISTRATION: "1" } }),
    /Pi did not register/,
  );
  assert.throws(() => readlinkSync(join(agentDir, "extensions/worktree")), {
    code: "ENOENT",
  });
});

test("rejects malformed settings before any package CLI call", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, ".pi/agent");
  mkdirSync(agentDir, { recursive: true });
  const settings = "{broken settings\n";
  writeFileSync(join(agentDir, "settings.json"), settings);
  assert.throws(() => setup(home, { env: { PI_SKIP_REGISTRATION: "1" } }));
  assert.equal(readFileSync(join(agentDir, "settings.json"), "utf8"), settings);
  assert.throws(() => readFileSync(join(home, "pi-installs.log")), { code: "ENOENT" });
  assert.throws(() => readlinkSync(join(agentDir, "extensions/worktree")), {
    code: "ENOENT",
  });
});

test("installs package and extensions in a custom Pi profile", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, "custom profile");
  setup(home, { env: { PI_CODING_AGENT_DIR: agentDir } });
  assert.equal(
    readlinkSync(join(agentDir, "extensions/worktree")),
    extensionOf(home, "worktree"),
  );
});

for (const entryKind of ["Git", "string", "source-only object", "relative string", "relative object", "duplicate"]) {
  test(`migrates an old ${entryKind} registration and preserves unrelated settings on repeated starts`, (t) => {
    const home = temporaryHome(t);
    const checkout = checkoutOf(home);
    const agentDir = join(home, "custom profile");
    const gitClone = join(agentDir, "git/github.com/mzizzi/mzizzi-dotfiles");
    mkdirSync(gitClone, { recursive: true });
    const oldPath = join(checkout, entryKind.includes("relative") ? "ai-rendered" : "generated", "pi/packages/mzizzi");
    const source = entryKind.startsWith("relative") ? relative(agentDir, oldPath) : oldPath;
    const entry = entryKind === "Git"
      ? "git:github.com/mzizzi/mzizzi-dotfiles@7fde4e6f964f524ba65f61d9e5276e9c0f7e27fa"
      : entryKind.includes("object") ? { source } : source;
    const unrelated = [
      "npm:unrelated",
      "git:github.com/mzizzi/mzizzi-dotfiles-other",
      { source: join(home, "another checkout/generated/pi/packages/mzizzi"), skills: [] },
    ];
    const oldEntries = entryKind === "duplicate" ? [entry, { source: relative(agentDir, oldPath) }] : [entry];
    const original = { theme: "dark", custom: { keep: true }, packages: [...unrelated, ...oldEntries] };
    const settingsPath = join(agentDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(original));

    setup(home, { env: { PI_CODING_AGENT_DIR: agentDir } });
    const migrated = readFileSync(settingsPath, "utf8");
    setup(home, { env: { PI_CODING_AGENT_DIR: agentDir } });

    assert.equal(readFileSync(settingsPath, "utf8"), migrated);
    assert.deepEqual(JSON.parse(migrated), {
      ...original, packages: [...unrelated, relative(agentDir, checkout)],
    });
    assert.throws(() => readdirSync(gitClone), { code: "ENOENT" });
  });
}

test("repairs registration on retry after a failed install", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, ".pi/agent");
  mkdirSync(agentDir, { recursive: true });
  const checkout = checkoutOf(home);
  const original = { theme: "dark", packages: ["npm:unrelated", join(checkout, "generated/pi/packages/mzizzi")] };
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify(original));

  assert.throws(() => setup(home, { env: { PI_EXIT_STATUS: "7" } }), /pi install failed \(7\)/);
  assert.deepEqual(packagesOf(agentDir), ["npm:unrelated"]);
  setup(home);
  assert.deepEqual(packagesOf(agentDir), ["npm:unrelated", relative(agentDir, checkout)]);
});

test("installs the complete extension on first boot and tolerates repeated boots", (t) => {
  const home = temporaryHome(t);
  const installed = join(home, ".pi/agent/extensions/attention-control");

  setup(home);
  setup(home);

  assert.equal(readlinkSync(installed), extensionOf(home, "attention-control"));
  assert.equal(
    readFileSync(join(installed, "index.js"), "utf8"),
    readFileSync(extensionOf(home, "attention-control/index.js"), "utf8"),
  );
  for (const name of ["style.md", "LICENSE", "UPSTREAM.md"]) {
    assert.equal(
      readFileSync(join(installed, name), "utf8"),
      readFileSync(extensionOf(home, `attention-control/${name}`), "utf8"),
    );
  }
});

test("installs the task extension with its supporting modules and license", (t) => {
  const home = temporaryHome(t);
  const source = extensionOf(home, "tasks");
  const installed = join(home, ".pi/agent/extensions/tasks");

  setup(home);
  setup(home);

  assert.equal(readlinkSync(installed), source);
  for (const name of ["index.js", "store.js", "LICENSE", "UPSTREAM.md"]) {
    assert.equal(
      readFileSync(join(installed, name), "utf8"),
      readFileSync(join(source, name), "utf8"),
    );
  }
});

test("installs the worktree extension with all supporting modules", (t) => {
  const home = temporaryHome(t);
  const source = extensionOf(home, "worktree");
  const installed = join(home, ".pi/agent/extensions/worktree");
  setup(home);
  setup(home);
  assert.equal(readlinkSync(installed), source);
  for (const name of ["index.js", "git-worktree.js", "transition.js"]) {
    assert.equal(
      readFileSync(join(installed, name), "utf8"),
      readFileSync(join(source, name), "utf8"),
    );
  }
});

test("installs multiple extension layouts without changing unrelated extensions", (t) => {
  const home = temporaryHome(t);
  const checkout = join(home, "layouts checkout");
  const script = copySetup(checkout);
  const source = join(checkout, "config/pi/extensions");
  mkdirSync(join(source, "bundled"), { recursive: true });
  writeFileSync(
    join(source, "bundled/index.js"),
    "export default function () {}\n",
  );
  writeFileSync(join(source, "first.js"), "export default function () {}\n");
  writeFileSync(join(source, "second.ts"), "export default function () {}\n");
  writeFileSync(join(source, "README.md"), "Not an extension.\n");
  const installed = join(home, ".pi/agent/extensions");
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, "unrelated.js"), "Existing extension.\n");

  setup(home, { script });
  setup(home, { script });

  assert.deepEqual(readdirSync(installed).sort(), [
    "bundled",
    "first.js",
    "second.ts",
    "unrelated.js",
  ]);
  for (const name of ["bundled", "first.js", "second.ts"]) {
    assert.equal(readlinkSync(join(installed, name)), join(source, name));
  }
  assert.deepEqual(packagesOf(join(home, ".pi/agent")), [relative(join(home, ".pi/agent"), checkout)]);
  assert.equal(
    readFileSync(join(installed, "unrelated.js"), "utf8"),
    "Existing extension.\n",
  );
});

test("replaces an outdated extension link", (t) => {
  const home = temporaryHome(t);
  const installed = join(home, ".pi/agent/extensions/attention-control");
  mkdirSync(dirname(installed), { recursive: true });
  symlinkSync("/missing/old-checkout", installed);

  setup(home);

  assert.equal(readlinkSync(installed), extensionOf(home, "attention-control"));
});

test("installs shared packages and the bundled style without an external prompt", (t) => {
  const home = temporaryHome(t);
  const bin = join(home, "bin");
  const subagentConfig = join(
    home,
    ".pi/agent/extensions/subagent/config.json",
  );
  mkdirSync(dirname(subagentConfig), { recursive: true });
  writeFileSync(subagentConfig, '{"maxSubagentSpawnsPerRun":64}\n');
  const sharedSetup = join(repoRoot, "sandbox/agent-lab/pi/setup.sh");
  execFileSync("bash", [sharedSetup], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    stdio: "pipe",
  });

  setup(home);
  setup(home);

  const agentDir = join(home, ".pi/agent");
  assert.throws(() => readFileSync(join(agentDir, "APPEND_SYSTEM.md")), {
    code: "ENOENT",
  });
  const bundledStyle = readFileSync(extensionOf(home, "attention-control/style.md"), "utf8");
  const settings = readFileSync(
    join(repoRoot, "sandbox/agent-lab/pi/settings.json"),
    "utf8",
  );
  const installedSettings = JSON.parse(
    readFileSync(join(agentDir, "settings.json"), "utf8"),
  );
  assert.deepEqual(installedSettings, {
    ...JSON.parse(settings),
    packages: [...JSON.parse(settings).packages, relative(agentDir, checkoutOf(home))],
  });
  assert.equal(installedSettings.defaultProvider, "openai-codex");
  assert.equal(installedSettings.defaultThinkingLevel, "high");
  assert.deepEqual(JSON.parse(readFileSync(subagentConfig, "utf8")), {
    globalConcurrencyLimit: 32,
    maxActiveAsyncRunsPerSession: 8,
    maxSubagentSpawnsPerRun: Number.MAX_SAFE_INTEGER,
    timeoutMs: 2147483647,
  });
  assert.equal(
    readFileSync(subagentConfig, "utf8"),
    readFileSync(join(repoRoot, "sandbox/agent-lab/pi/subagents.json"), "utf8"),
  );
  assert.deepEqual(
    logLines(home, "pi-installs.log"),
    [
      ...JSON.parse(settings).packages.map((source) => `install ${source}`),
      ...Array(2).fill(`install ${checkoutOf(home)}`),
    ],
  );
  const handlers = new Map();
  attentionControl({ on: (event, callback) => handlers.set(event, callback) });
  const event = {
    systemPrompt: "Existing Pi instructions.",
    systemPromptOptions: { sections: {} },
  };
  handlers.get("before_agent_start")(event);
  assert.deepEqual(event.systemPromptOptions.sections, {
    attention_control: bundledStyle,
  });
  const result = handlers.get("context_with_system")(
    { messages: [] },
    { getSystemPrompt: () => event.systemPrompt + "\n\n" + bundledStyle },
  );
  assert.equal(result.messages.at(-1).customType, "attention-control-reminder");
});

test("rebuild replaces a Git registration with the checkout and removes its clone", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, ".pi/agent");
  const gitClone = join(agentDir, "git/github.com/mzizzi/mzizzi-dotfiles");
  mkdirSync(gitClone, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    packages: ["git:github.com/mzizzi/mzizzi-dotfiles@7fde4e6f964f524ba65f61d9e5276e9c0f7e27fa"],
  }));
  setup(home, { script: join(repoRoot, "sandbox/agent-lab/pi/setup.sh") });
  setup(home);
  assert.deepEqual(packagesOf(agentDir), [
    ...JSON.parse(readFileSync(join(repoRoot, "sandbox/agent-lab/pi/settings.json"), "utf8")).packages,
    relative(agentDir, checkoutOf(home)),
  ]);
  assert.throws(() => readdirSync(gitClone), { code: "ENOENT" });
});

test("setup preserves user-authored append instructions", (t) => {
  const home = temporaryHome(t);
  const append = join(home, ".pi/agent/APPEND_SYSTEM.md");
  const instructions = "# Personal instructions\n\nKeep these instructions.\n";
  mkdirSync(dirname(append), { recursive: true });
  writeFileSync(append, instructions);
  setup(home, { script: join(repoRoot, "sandbox/agent-lab/pi/setup.sh") });
  setup(home);
  assert.equal(readFileSync(append, "utf8"), instructions);
});

test("sandbox configuration needs no external Attention Control checkout", () => {
  const kit = readFileSync(join(repoRoot, "sandbox/agent-lab/agent-lab.yaml"), "utf8");
  const environment = readFileSync(join(repoRoot, "sandbox/sbxenv.yaml"), "utf8");
  assert.match(kit, /command: "bash \/opt\/pi-setup\/setup\.sh"/);
  assert.doesNotMatch(kit + environment, /code\/attention-control/);
});

test("does not inject Attention Control into background subagents", () => {
  const previous = process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    const handlers = new Map();
    attentionControl({
      on: (event, callback) => handlers.set(event, callback),
    });
    assert.equal(handlers.size, 0);
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }
});

test("does not install a nested link inside an existing real directory", (t) => {
  const home = temporaryHome(t);
  const installed = join(home, ".pi/agent/extensions/attention-control");
  mkdirSync(installed, { recursive: true });

  assert.throws(() => setup(home));
  assert.deepEqual(readdirSync(installed), []);
});
