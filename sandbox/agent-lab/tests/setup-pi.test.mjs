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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
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
    join(bin, "uv"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/render-args.log"\nexit "${UV_EXIT_STATUS:-0}"\n',
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
if (process.env.PI_SKIP_REGISTRATION || !path.isAbsolute(args[1])) process.exit(0);
const agentDir = process.env.PI_CODING_AGENT_DIR || path.join(process.env.HOME, ".pi/agent");
fs.mkdirSync(agentDir, {recursive: true});
const settingsPath = path.join(agentDir, "settings.json");
const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, "utf8")) : {};
settings.packages ??= [];
if (!settings.packages.includes(args[1])) settings.packages.push(args[1]);
fs.writeFileSync(settingsPath, JSON.stringify(settings));
`,
    { mode: 0o755 },
  );
  return home;
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

test("renders and registers the Pi package on repeated boots", (t) => {
  const home = temporaryHome(t);
  setup(home);
  setup(home);
  assert.deepEqual(
    readFileSync(join(home, "render-args.log"), "utf8").trim().split("\n"),
    [
      "run",
      "--no-project",
      "--with-requirements",
      join(repoRoot, "ai-renderer/requirements.txt"),
      "python",
      join(repoRoot, "ai-renderer/render_ai.py"),
      "--target",
      "pi",
    ],
  );
  assert.deepEqual(
    readFileSync(join(home, "pi-installs.log"), "utf8").trim().split("\n"),
    [
      `install ${join(repoRoot, "generated/pi/packages/mzizzi")}`,
      `install ${join(repoRoot, "generated/pi/packages/mzizzi")}`,
    ],
  );
});

test("stops before package registration when rendering fails", (t) => {
  const home = temporaryHome(t);
  assert.throws(() => setup(home, setupScript, { UV_EXIT_STATUS: "1" }));
  assert.throws(() => readFileSync(join(home, "pi-installs.log")), {
    code: "ENOENT",
  });
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

test("rejects malformed settings without repairing them after a successful CLI exit", (t) => {
  const home = temporaryHome(t);
  const agentDir = join(home, ".pi/agent");
  mkdirSync(agentDir, { recursive: true });
  const settings = "{broken settings\n";
  writeFileSync(join(agentDir, "settings.json"), settings);
  assert.throws(() => setup(home, setupScript, { PI_SKIP_REGISTRATION: "1" }));
  assert.equal(readFileSync(join(agentDir, "settings.json"), "utf8"), settings);
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
  assert.equal(
    readFileSync(join(installed, "style.md"), "utf8"),
    readFileSync(join(extension, "style.md"), "utf8"),
  );
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
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(setupScript, script);
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
  assert.deepEqual(readFileSync(join(home, "render-args.log"), "utf8").trim().split("\n"), [
    "run", "--no-project", "--with-requirements", join(checkout, "ai-renderer/requirements.txt"),
    "python", join(checkout, "ai-renderer/render_ai.py"), "--target", "pi",
  ]);
  assert.deepEqual(readFileSync(join(home, "pi-installs.log"), "utf8").trim().split("\n"), [
    `install ${join(checkout, "generated/pi/packages/mzizzi")}`,
    `install ${join(checkout, "generated/pi/packages/mzizzi")}`,
  ]);
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

test("preserves the shared setup's external style and packages while adding reminders", (t) => {
  const home = temporaryHome(t);
  const bin = join(home, "bin");
  const style = join(home, "external-style.md");
  const body = '\n# Attention Control\n\nUse the external style.\n\n6. **Restate state every turn.** The reader cannot hold "step 3 of 5" between messages.\n';
  const taskMandate = " If the harness has a task tool, use it for multi-step work: one item per step, one in progress at a time. The checklist does the restating. Do not also narrate the plan as prose.";
  const sourceStyle = "---\r\nname: Attention Control\r\n---\r\n" +
    (body.trimEnd() + taskMandate + "\n").replaceAll("\n", "\r\n");
  writeFileSync(style, sourceStyle);
  const subagentConfig = join(
    home,
    ".pi/agent/extensions/subagent/config.json",
  );
  mkdirSync(dirname(subagentConfig), { recursive: true });
  writeFileSync(subagentConfig, '{"maxSubagentSpawnsPerRun":64}\n');
  const sharedSetup = join(repoRoot, "sandbox/agent-lab/pi/setup.sh");
  execFileSync("bash", [sharedSetup, style], {
    env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
    stdio: "pipe",
  });

  setup(home);
  setup(home);

  const agentDir = join(home, ".pi/agent");
  const installedStyle = readFileSync(
    join(agentDir, "APPEND_SYSTEM.md"),
    "utf8",
  );
  assert.equal(installedStyle, body);
  assert.equal(readFileSync(style, "utf8"), sourceStyle);
  assert.ok(!readFileSync(join(extension, "style.md"), "utf8").includes("If the harness has a task tool"));
  const settings = readFileSync(
    join(repoRoot, "sandbox/agent-lab/pi/settings.json"),
    "utf8",
  );
  const installedSettings = JSON.parse(
    readFileSync(join(agentDir, "settings.json"), "utf8"),
  );
  assert.deepEqual(installedSettings, {
    ...JSON.parse(settings),
    packages: [...JSON.parse(settings).packages, join(repoRoot, "generated/pi/packages/mzizzi")],
  });
  assert.equal(installedSettings.defaultProvider, "chatgpt");
  assert.equal(installedSettings.defaultModel, "gpt-6.1-sol");
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
      ...Array(2).fill(`install ${join(repoRoot, "generated/pi/packages/mzizzi")}`),
    ],
  );
  const handlers = new Map();
  attentionControl({ on: (event, callback) => handlers.set(event, callback) });
  const event = {
    systemPrompt: installedStyle,
    systemPromptOptions: { sections: {} },
  };
  handlers.get("before_agent_start")(event);
  assert.deepEqual(event.systemPromptOptions.sections, {});
  const result = handlers.get("context_with_system")(
    { messages: [] },
    { getSystemPrompt: () => installedStyle },
  );
  assert.equal(result.messages.at(-1).customType, "attention-control-reminder");
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
