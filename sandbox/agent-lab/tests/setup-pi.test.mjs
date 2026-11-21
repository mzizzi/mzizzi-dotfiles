import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { packageSource } from "../pi/mzizzi-package.mjs";
import attentionControl from "../../../config/pi/extensions/attention-control/index.js";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const setupScript = join(repoRoot, "sandbox/agent-lab/bin/setup-pi.sh");
const extension = join(repoRoot, "config/pi/extensions/attention-control");

function temporaryHome(t) {
  const home = mkdtempSync(join(tmpdir(), "setup-pi-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    '#!/bin/sh\ntest "$1 $2" = "rev-parse HEAD" && head -1 fixture-head\n',
    { mode: 0o755 },
  );
  writeFileSync(
    join(bin, "pi"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.env.HOME, "pi-installs.log"), args.join(" ") + "\\n");
fs.appendFileSync(path.join(process.env.HOME, "pi-calls.jsonl"), JSON.stringify({args, cwd: process.cwd()}) + "\\n");
const status = process.env.PI_EXIT_STATUS || process.env["PI_" + args[0].toUpperCase() + "_EXIT_STATUS"];
if (status) process.exit(Number(status));
if (args[0] === "install" && (process.env.PI_SKIP_REGISTRATION || args[1] !== ${JSON.stringify(packageSource)})) process.exit(0);
if (args[0] === "remove" && process.env.PI_SKIP_REMOVAL) process.exit(0);
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME, ".pi/agent");
fs.mkdirSync(agentDir, {recursive: true});
const settingsPath = path.join(agentDir, "settings.json");
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
settings.packages ??= [];
const source = (entry) => typeof entry === "string" ? entry : entry.source;
if (args[0] === "remove") {
  const removed = path.resolve(process.cwd(), args[1]);
  settings.packages = settings.packages.filter((entry) => path.resolve(agentDir, source(entry)) !== removed);
} else if (args[0] === "install") {
  if (!settings.packages.some((entry) => source(entry) === args[1])) settings.packages.push(args[1]);
  const [repo, sha] = args[1].slice(4).split("@");
  const root = path.join(agentDir, "git", repo);
  fs.mkdirSync(path.join(root, "node_modules/pi-code/extensions"), {recursive: true});
  fs.writeFileSync(path.join(root, "fixture-head"), sha);
  if (!process.env.PI_SKIP_DEPENDENCY) fs.writeFileSync(path.join(root, "node_modules/pi-code/extensions/claude-rules.ts"), "");
} else {
  process.exit(2);
}
fs.writeFileSync(settingsPath, JSON.stringify(settings));
`,
    { mode: 0o755 },
  );
  return home;
}

function copySetup(script) {
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(setupScript, script);
  const module = "../pi/mzizzi-package.mjs";
  mkdirSync(dirname(join(dirname(script), module)), { recursive: true });
  copyFileSync(join(dirname(setupScript), module), join(dirname(script), module));
}

function setup(home, script = setupScript, env = {}) {
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

test("installs the pinned Git package once across repeated boots", (t) => {
  const home = temporaryHome(t);
  setup(home);
  setup(home);
  assert.match(packageSource, /^git:github\.com\/mzizzi\/mzizzi-dotfiles@[0-9a-f]{40}$/);
  assert.equal(readFileSync(join(home, "pi-installs.log"), "utf8").trim(), `install ${packageSource}`);
});

test("incomplete install leaves a fresh profile unregistered", (t) => {
  const home = temporaryHome(t);
  assert.throws(() => setup(home, setupScript, { PI_SKIP_DEPENDENCY: "1" }), /Incomplete mzizzi install/);
  assert.throws(() => readFileSync(join(home, ".pi/agent/settings.json")), { code: "ENOENT" });
});

test("reports package registration failure instead of completing setup", (t) => {
  const home = temporaryHome(t);
  assert.throws(() => setup(home, setupScript, { PI_EXIT_STATUS: "1" }));
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
    () => setup(home, setupScript, { PI_SKIP_REGISTRATION: "1" }),
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
  assert.throws(() => setup(home, setupScript, { PI_SKIP_REGISTRATION: "1" }));
  assert.equal(readFileSync(join(agentDir, "settings.json"), "utf8"), settings);
  assert.throws(() => readFileSync(join(home, "pi-installs.log")), { code: "ENOENT" });
  assert.throws(() => readlinkSync(join(agentDir, "extensions/worktree")), {
    code: "ENOENT",
  });
});

test("installs package and extensions in a custom Pi profile", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, "custom profile");
  setup(home, setupScript, { PI_CODING_AGENT_DIR: agentDir });
  assert.equal(
    readlinkSync(join(agentDir, "extensions/worktree")),
    join(repoRoot, "config/pi/extensions/worktree"),
  );
});

for (const entryKind of ["string", "source-only object", "relative string", "relative object", "duplicate registrations"]) {
  test(`migrates an old ${entryKind} and preserves unrelated settings on repeated starts`, (t) => {
    const home = temporaryHome(t);
    const checkout = join(home, "checkout with spaces");
    const script = join(checkout, "sandbox/agent-lab/bin/setup-pi.sh");
    copySetup(script);
    const agentDir = join(home, "custom profile");
    mkdirSync(agentDir);
    const oldPath = join(checkout, entryKind.includes("relative") ? "ai-rendered" : "generated", "pi/packages/mzizzi");
    const newPath = packageSource;
    const source = entryKind.startsWith("relative") ? relative(agentDir, oldPath) : oldPath;
    const entry = entryKind.includes("object") ? { source } : source;
    const unrelated = ["npm:unrelated", { source: join(home, "another checkout/generated/pi/packages/mzizzi"), skills: [] }];
    const oldEntries = entryKind === "duplicate registrations" ? [entry, { source: relative(agentDir, oldPath) }] : [entry];
    const original = { theme: "dark", custom: { keep: true }, packages: [...unrelated, ...oldEntries] };
    const settingsPath = join(agentDir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify(original));

    setup(home, script, { PI_CODING_AGENT_DIR: agentDir });
    setup(home, script, { PI_CODING_AGENT_DIR: agentDir });

    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
      ...original, packages: [...unrelated, newPath],
    });
    const calls = readFileSync(join(home, "pi-calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.deepEqual(calls, [
      { args: ["install", newPath], cwd: agentDir },
      { args: ["remove", oldPath], cwd: agentDir },
    ]);
  });
}

for (const mixed of [false, true]) {
  test(`rejects restricted old registrations before any CLI mutation${mixed ? " even after a simple old entry" : ""}`, (t) => {
    const home = temporaryHome(t);
    const agentDir = join(home, ".pi/agent");
    mkdirSync(agentDir, { recursive: true });
    const oldPath = join(repoRoot, "generated/pi/packages/mzizzi");
    const packages = [...(mixed ? [oldPath] : []), { source: oldPath, skills: [] }];
    const settingsPath = join(agentDir, "settings.json");
    const original = JSON.stringify({ theme: "dark", packages }, null, 2) + "\n";
    writeFileSync(settingsPath, original);

    assert.throws(() => setup(home), (error) => {
      assert.match(error.stderr.toString(), /Review restricted mzizzi package/);
      assert.ok(error.stderr.toString().includes(settingsPath));
      assert.ok(error.stderr.toString().includes(packageSource));
      return true;
    });
    assert.equal(readFileSync(settingsPath, "utf8"), original);
    assert.throws(() => readFileSync(join(home, "pi-installs.log")), { code: "ENOENT" });
  });
}

for (const command of ["remove", "install"]) {
  test(`propagates migration ${command} failures and repairs registration on retry`, (t) => {
    const home = temporaryHome(t);
    const agentDir = join(home, ".pi/agent");
    mkdirSync(agentDir, { recursive: true });
    const oldPath = join(repoRoot, "generated/pi/packages/mzizzi");
    const newPath = packageSource;
    const settingsPath = join(agentDir, "settings.json");
    const original = { theme: "dark", packages: ["npm:unrelated", oldPath] };
    writeFileSync(settingsPath, JSON.stringify(original));

    assert.throws(() => setup(home, setupScript, { [`PI_${command.toUpperCase()}_EXIT_STATUS`]: "7" }), new RegExp(`pi ${command} failed \\(7\\)`));
    const calls = readFileSync(join(home, "pi-installs.log"), "utf8").trim().split("\n");
    assert.deepEqual(calls, command === "remove" ? [`install ${newPath}`, `remove ${oldPath}`] : [`install ${newPath}`]);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), original);
    setup(home);
    assert.deepEqual(JSON.parse(readFileSync(settingsPath, "utf8")), {
      ...original, packages: ["npm:unrelated", newPath],
    });
  });
}

test("rejects a successful removal that leaves the old registration", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, ".pi/agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    packages: [join(repoRoot, "generated/pi/packages/mzizzi")],
  }));
  assert.throws(() => setup(home, setupScript, { PI_SKIP_REMOVAL: "1" }), /Pi did not remove/);
});

test("installs the complete extension on first boot and tolerates repeated boots", (t) => {
  const home = temporaryHome(t);
  const installed = join(home, ".pi/agent/extensions/attention-control");

  setup(home);
  setup(home);

  assert.equal(readlinkSync(installed), extension);
  assert.equal(
    readFileSync(join(installed, "index.js"), "utf8"),
    readFileSync(join(extension, "index.js"), "utf8"),
  );
  for (const name of ["style.md", "LICENSE", "UPSTREAM.md"]) {
    assert.equal(
      readFileSync(join(installed, name), "utf8"),
      readFileSync(join(extension, name), "utf8"),
    );
  }
});

test("installs the task extension with its supporting modules and license", (t) => {
  const home = temporaryHome(t);
  const source = join(repoRoot, "config/pi/extensions/tasks");
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
  const source = join(repoRoot, "config/pi/extensions/worktree");
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
  const checkout = join(home, "checkout with spaces");
  const script = join(checkout, "sandbox/agent-lab/bin/setup-pi.sh");
  const source = join(checkout, "config/pi/extensions");
  copySetup(script);
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

  setup(home, script);
  setup(home, script);

  assert.deepEqual(readdirSync(installed).sort(), [
    "bundled",
    "first.js",
    "second.ts",
    "unrelated.js",
  ]);
  for (const name of ["bundled", "first.js", "second.ts"]) {
    assert.equal(readlinkSync(join(installed, name)), join(source, name));
  }
  assert.equal(readFileSync(join(home, "pi-installs.log"), "utf8").trim(), `install ${packageSource}`);
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

  assert.equal(readlinkSync(installed), extension);
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
  const bundledStyle = readFileSync(join(extension, "style.md"), "utf8");
  const settings = readFileSync(
    join(repoRoot, "sandbox/agent-lab/pi/settings.json"),
    "utf8",
  );
  const installedSettings = JSON.parse(
    readFileSync(join(agentDir, "settings.json"), "utf8"),
  );
  assert.deepEqual(installedSettings, {
    ...JSON.parse(settings),
    packages: [...JSON.parse(settings).packages, packageSource],
  });
  assert.equal(installedSettings.defaultProvider, "openai-codex");
  assert.equal(installedSettings.defaultThinkingLevel, "high");
  assert.deepEqual(JSON.parse(readFileSync(subagentConfig, "utf8")), {
    globalConcurrencyLimit: 32,
    maxActiveAsyncRunsPerSession: 8,
    maxSubagentSpawnsPerRun: 8,
  });
  assert.equal(
    readFileSync(subagentConfig, "utf8"),
    readFileSync(join(repoRoot, "sandbox/agent-lab/pi/subagents.json"), "utf8"),
  );
  assert.deepEqual(
    readFileSync(join(home, "pi-installs.log"), "utf8").trim().split("\n"),
    [
      ...JSON.parse(settings).packages.map((source) => `install ${source}`),
      `install ${packageSource}`,
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

test("rebuild preserves the working local registration until startup installs the Git package", (t) => {
  const home = temporaryHome(t);
  const profile = join(home, ".pi/agent");
  mkdirSync(profile, { recursive: true });
  const settings = join(profile, "settings.json");
  const old = join(repoRoot, "ai-rendered/pi/packages/mzizzi");
  const base = join(repoRoot, "sandbox/agent-lab/pi/setup.sh");
  const restricted = JSON.stringify({ packages: [{ source: old, skills: [] }] });
  writeFileSync(settings, restricted);
  assert.throws(() => setup(home, base), /Review restricted mzizzi package/);
  assert.equal(readFileSync(settings, "utf8"), restricted);
  writeFileSync(settings, JSON.stringify({ packages: [old] }));
  setup(home, base);
  const before = readFileSync(settings, "utf8");
  assert.ok(JSON.parse(before).packages.includes(old));
  assert.throws(() => setup(home, setupScript, { PI_INSTALL_EXIT_STATUS: "7" }), /pi install failed/);
  assert.equal(readFileSync(settings, "utf8"), before);
  setup(home);
  const saved = JSON.parse(readFileSync(settings, "utf8")).packages;
  assert.ok(!saved.includes(old));
  assert.equal(saved.filter(spec => spec === packageSource).length, 1);
});

test("setup preserves user-authored append instructions", (t) => {
  const home = temporaryHome(t);
  const append = join(home, ".pi/agent/APPEND_SYSTEM.md");
  const instructions = "# Personal instructions\n\nKeep these instructions.\n";
  mkdirSync(dirname(append), { recursive: true });
  writeFileSync(append, instructions);
  setup(home, join(repoRoot, "sandbox/agent-lab/pi/setup.sh"));
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
