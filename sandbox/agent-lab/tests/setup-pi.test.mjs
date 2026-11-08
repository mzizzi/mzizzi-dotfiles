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
  return home;
}

function setup(home, script = setupScript) {
  execFileSync("bash", [script], {
    cwd: tmpdir(),
    env: { ...process.env, HOME: home },
    stdio: "pipe",
  });
}

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
  mkdirSync(bin);
  writeFileSync(
    join(bin, "pi"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HOME/pi-installs.log"\n',
    { mode: 0o755 },
  );
  const style = join(home, "external-style.md");
  const body = "\n# Attention Control\n\nUse the external style.\n";
  writeFileSync(
    style,
    "---\r\nname: Attention Control\r\n---\r\n" + body.replaceAll("\n", "\r\n"),
  );
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
  const settings = readFileSync(
    join(repoRoot, "sandbox/agent-lab/pi/settings.json"),
    "utf8",
  );
  assert.equal(readFileSync(join(agentDir, "settings.json"), "utf8"), settings);
  const installedSettings = JSON.parse(
    readFileSync(join(agentDir, "settings.json"), "utf8"),
  );
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
    JSON.parse(settings).packages.map((source) => `install ${source}`),
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
