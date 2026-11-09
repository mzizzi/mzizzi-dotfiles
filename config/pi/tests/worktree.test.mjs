import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import test from "node:test";
import worktree from "../extensions/worktree/index.js";
import {
  checkDestination,
  inspectCheckout,
  parseWorktrees,
} from "../extensions/worktree/git-worktree.js";
import { batchRefusal, STATE_TYPE } from "../extensions/worktree/transition.js";
import { fixture, git } from "./worktree-fixture.mjs";

export async function harness(f, options = {}) {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  const entries = options.entries ?? [];
  const messages = [];
  const notices = [];
  let queued = false;
  let failSave = false;
  let approve = true;
  const ctx = {
    mode: "tui",
    hasUI: true,
    cwd: options.cwd ?? f.source,
    isIdle: () => true,
    hasPendingMessages: () => queued,
    sessionManager: {
      getSessionFile: () => join(f.dir, "session.jsonl"),
      getBranch: () => entries,
      getEntries: () => entries,
    },
    ui: {
      confirm: async () => approve,
      notify: (message) => notices.push(message),
    },
  };
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => {
      if (failSave) throw new Error("disk full");
      entries.push({ type: "custom", customType, data: structuredClone(data) });
    },
    sendUserMessage: (text, options) => messages.push({ text, options }),
  };
  worktree(pi);
  const event = (name, value = {}) => handlers.get(name)?.(value, ctx);
  await event("session_start");
  const call = (name, args = {}, signal) =>
    tools.get(name).execute("call", args, signal, undefined, ctx);
  return {
    ctx,
    entries,
    tools,
    commands,
    messages,
    notices,
    event,
    call,
    queue: (value = true) => {
      queued = value;
    },
    failSave: () => {
      failSave = true;
    },
    decline: () => {
      approve = false;
    },
  };
}

const text = (result) => result.content[0].text;
const assistant = (calls) => ({
  type: "message",
  message: {
    role: "assistant",
    content: calls.map(([id, name]) => ({
      type: "toolCall",
      id,
      name,
      arguments: {},
    })),
  },
});

test("inspects registered dirty/detached worktrees and source subdirectories without Git mutations", async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.source, "source-only.txt"), "keep source edits");
  writeFileSync(join(f.target, "same.txt"), "target edits\n");
  const before = git(f.source, "status", "--porcelain");
  const { source, target } = await checkDestination(
    join(f.source, "subdir"),
    f.target,
  );
  assert.equal(source.dirty, true);
  assert.equal(target.dirty, true);
  assert.equal(target.branch, "feature");
  assert.equal((await inspectCheckout(f.review)).detached, true);
  assert.equal(git(f.source, "status", "--porcelain"), before);
  assert.equal(
    readFileSync(join(f.target, "same.txt"), "utf8"),
    "target edits\n",
  );
  await assert.rejects(
    checkDestination(f.source, join(f.target, "subdir")),
    /root/,
  );
  await assert.rejects(
    checkDestination(f.source, join(f.dir, "missing")),
    /ENOENT/,
  );
});

test("canonicalizes aliases and rejects foreign repositories", async (t) => {
  const f = fixture(t);
  const alias = join(f.dir, "alias");
  symlinkSync(f.target, alias);
  assert.equal(
    (await checkDestination(f.source, alias)).destinationCwd,
    f.target,
  );
  const foreign = join(f.dir, "foreign");
  mkdirSync(foreign);
  git(foreign, "init", "-b", "main");
  git(foreign, "config", "user.name", "Fixture");
  git(foreign, "config", "user.email", "fixture@example.test");
  git(foreign, "commit", "--allow-empty", "-m", "foreign");
  await assert.rejects(
    checkDestination(f.source, foreign),
    /different Git repository/,
  );
});

test("parses NUL-delimited paths with spaces and newlines", () => {
  assert.deepEqual(
    parseWorktrees(
      "worktree /a path\nname\0HEAD abc\0branch refs/heads/main\0\0worktree /b\0HEAD def\0detached\0\0",
    ),
    [
      { path: "/a path\nname", head: "abc", branch: "refs/heads/main" },
      { path: "/b", head: "def", detached: true },
    ],
  );
  assert.throws(() => parseWorktrees("HEAD abc\0"), /Invalid/);
});

test("rejects every sibling in both mixed orders, unknown/invalid siblings, and nested transitions", () => {
  for (const calls of [
    [
      ["a", "EnterWorktree"],
      ["b", "write"],
    ],
    [
      ["b", "write"],
      ["a", "EnterWorktree"],
    ],
    [
      ["a", "EnterWorktree"],
      ["b", "ExitWorktree"],
    ],
    [
      ["b", "unknown"],
      ["a", "EnterWorktree"],
    ],
  ]) {
    const manager = { getBranch: () => [assistant(calls)] };
    for (const [id, toolName] of calls)
      assert.match(
        batchRefusal({ toolCallId: id, toolName }, manager),
        /entire batch/,
      );
  }
  const manager = { getBranch: () => [assistant([["a", "EnterWorktree"]])] };
  assert.equal(
    batchRefusal({ toolCallId: "a", toolName: "EnterWorktree" }, manager),
    null,
  );
  assert.match(
    batchRefusal({ toolCallId: "missing", toolName: "write" }, manager),
    /Cannot resolve/,
  );
  assert.match(
    batchRefusal(
      {
        toolCallId: "nested",
        toolName: "EnterWorktree",
        parentToolCallId: "outer",
      },
      manager,
    ),
    /Nested/,
  );
  assert.equal(
    batchRefusal(
      { toolCallId: "nested", toolName: "read", parentToolCallId: "outer" },
      manager,
    ),
    null,
  );
});

test("registers only model-only sequential transitions and refuses unsupported operations/contexts", async (t) => {
  const f = fixture(t);
  const h = await harness(f);
  assert.deepEqual([...h.tools.keys()], ["EnterWorktree", "ExitWorktree"]);
  for (const tool of h.tools.values()) {
    assert.equal(tool.executionMode, "sequential");
    assert.equal(tool.exposure, "model-only");
  }
  const entry = h.tools.get("EnterWorktree");
  assert.match(entry.description, /Pass path only; omit name/);
  assert.match(entry.parameters.properties.path.description, /omit name/);
  assert.deepEqual(Object.keys(entry.parameters.properties), ["path"]);
  assert.deepEqual(entry.parameters.required, ["path"]);
  const exit = h.tools.get("ExitWorktree");
  assert.deepEqual(Object.keys(exit.parameters.properties), ["action"]);
  assert.deepEqual(exit.parameters.properties.action.enum, ["keep"]);
  for (const params of [{}, { name: "new" }, { name: "x", path: f.target }])
    await assert.rejects(h.call("EnterWorktree", params), /supports only/);
  for (const params of [
    { action: "remove" },
    { action: "keep", discard_changes: false },
  ])
    await assert.rejects(h.call("ExitWorktree", params), /supports only/);
  await assert.rejects(h.call("ExitWorktree", { action: "keep" }), /No active/);
  h.ctx.mode = "rpc";
  await assert.rejects(
    h.call("EnterWorktree", { path: f.target }),
    /interactive/,
  );
  h.ctx.mode = "tui";
  h.ctx.sessionManager.getSessionFile = () => undefined;
  await assert.rejects(
    h.call("EnterWorktree", { path: f.target }),
    /persisted/,
  );
});

test("scheduled entry preserves source, blocks tools/shell, and dispatches only after settlement", async (t) => {
  const f = fixture(t);
  const h = await harness(f, { cwd: join(f.source, "subdir") });
  writeFileSync(join(f.target, "target-only"), "dirty");
  const scheduled = await h.call("EnterWorktree", { path: f.target });
  assert.match(text(scheduled), /scheduled; cwd has not changed/);
  assert.equal(scheduled.terminate, true);
  assert.equal(scheduled.details.dirty, true);
  assert.equal(h.ctx.cwd, join(f.source, "subdir"));
  assert.equal(h.entries.at(-1).data.originalCwd, h.ctx.cwd);
  assert.equal((await h.event("tool_call", { toolName: "write" })).block, true);
  assert.equal((await h.event("user_bash")).result.exitCode, 1);
  assert.equal(h.messages.length, 0);
  await h.event("agent_settled", { aborted: false });
  assert.match(h.messages[0].text, /^\/mzizzi-worktree-transition /);
  assert.equal(h.messages[0].options.expandPromptTemplates, true);
});

test("new/queued input, manual operations, abort, and declined confirmation leave cwd unchanged", async (t) => {
  const f = fixture(t);
  for (const [event, value] of [
    ["input", { source: "interactive" }],
    ["message_end", { message: { role: "user" } }],
    ["message_end", { message: { role: "custom" } }],
    ["before_agent_start", { messageType: "custom" }],
    ["session_before_switch", { targetSessionFile: "other" }],
    ["session_before_fork", {}],
    ["session_before_tree", {}],
    ["session_shutdown", { reason: "reload" }],
    ["agent_settled", { aborted: true }],
  ]) {
    const h = await harness(f);
    await h.call("EnterWorktree", { path: f.target });
    await h.event(event, value);
    assert.equal(h.entries.at(-1).data.status, "idle");
    assert.equal(h.ctx.cwd, f.source);
    assert.equal(h.messages.length, 0);
  }
  const queued = await harness(f);
  queued.queue();
  await assert.rejects(
    queued.call("EnterWorktree", { path: f.target }),
    /Queued/,
  );
  const declined = await harness(f);
  declined.decline();
  await assert.rejects(
    declined.call("EnterWorktree", { path: f.target }),
    /declined/,
  );
  assert.equal(declined.entries.length, 0);
});

test("input during confirmation refuses scheduling, while the initiating prompt does not", async (t) => {
  const f = fixture(t);
  const h = await harness(f);
  h.ctx.isIdle = () => false;
  await h.event("before_agent_start", { messageType: "user" });
  await h.event("message_end", { message: { role: "user" } });
  h.ctx.ui.confirm = async () => {
    await h.event("input", {});
    return true;
  };
  await assert.rejects(
    h.call("EnterWorktree", { path: f.target }),
    /New input/,
  );
  assert.equal(h.entries.length, 0);
});

test("restored pending state needs explicit cancellation and cannot auto-replay", async (t) => {
  const f = fixture(t);
  const h = await harness(f);
  await h.call("EnterWorktree", { path: f.target });
  const restored = await harness(f, { entries: structuredClone(h.entries) });
  assert.equal(
    (await restored.event("tool_call", { toolName: "read" })).block,
    true,
  );
  await restored.event("agent_settled", {});
  assert.equal(restored.messages.length, 0);
  await restored.commands.get("worktree-cancel").handler("", restored.ctx);
  assert.equal(restored.entries.at(-1).data.status, "idle");
  await restored.call("EnterWorktree", { path: f.target });
  restored.failSave();
  assert.throws(() => restored.event("input", {}), /disk full/);
  assert.equal(
    (await restored.event("tool_call", { toolName: "write" })).block,
    true,
  );
});

test("tree mismatch and corrupt state fail closed; already-active entry is a no-op", async (t) => {
  const f = fixture(t);
  const h = await harness(f);
  assert.match(
    text(await h.call("EnterWorktree", { path: f.source })),
    /Already/,
  );
  assert.equal(h.entries.length, 0);
  const current = await inspectCheckout(f.source);
  const mismatch = await harness(f, {
    cwd: f.target,
    entries: [
      {
        type: "custom",
        customType: STATE_TYPE,
        data: { version: 1, status: "active", currentCwd: f.source, current },
      },
    ],
  });
  assert.equal(
    (await mismatch.event("tool_call", { toolName: "write" })).block,
    true,
  );
  const corrupt = await harness(f, {
    entries: [{ type: "custom", customType: STATE_TYPE, data: {} }],
  });
  assert.equal(
    (await corrupt.event("tool_call", { toolName: "write" })).block,
    true,
  );
});

test("missing origin refuses exit rather than guessing another checkout", async (t) => {
  const f = fixture(t);
  const origin = await inspectCheckout(f.target);
  const current = await inspectCheckout(f.review);
  const h = await harness(f, {
    cwd: f.review,
    entries: [
      {
        type: "custom",
        customType: STATE_TYPE,
        data: {
          version: 1,
          status: "active",
          originalCwd: f.target,
          origin,
          currentCwd: f.review,
          current,
        },
      },
    ],
  });
  git(f.source, "worktree", "remove", f.target);
  await assert.rejects(h.call("ExitWorktree", { action: "keep" }), /ENOENT/);
  assert.equal(h.entries.length, 1);
  assert.equal(h.ctx.cwd, f.review);
});

test("duplicate internal commands cannot start concurrent replacements", async (t) => {
  const f = fixture(t);
  const h = await harness(f);
  const scheduled = await h.call("EnterWorktree", { path: f.target });
  h.ctx.waitForIdle = () =>
    assert.fail("The handoff must return before replacement starts");
  const command = h.commands.get("mzizzi-worktree-transition");
  await command.handler(`${scheduled.details.transitionId} commit`, h.ctx);
  assert.match(h.notices.at(-1), /no live handoff/);
  await command.handler(scheduled.details.transitionId, h.ctx);
  await command.handler(scheduled.details.transitionId, h.ctx);
  assert.match(h.notices.at(-1), /Stale or duplicate/);
  await h.event("input", {});
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.messages.length, 0);
  assert.equal(h.ctx.cwd, f.source);
});

test("shutdown cancels a scheduled dispatch without starting replacement", async (t) => {
  const f = fixture(t);
  const h = await harness(f);
  const scheduled = await h.call("EnterWorktree", { path: f.target });
  await h.commands
    .get("mzizzi-worktree-transition")
    .handler(scheduled.details.transitionId, h.ctx);
  await h.event("session_shutdown", { reason: "reload" });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(h.messages.length, 0);
  assert.equal(h.entries.at(-1).data.status, "idle");
});

test("unchanged branch inspector retains every recommendation and dirty-edit classification", (t) => {
  const f = fixture(t);
  const plan = join(f.source, "plans/20261107-skill-port");
  mkdirSync(plan, { recursive: true });
  writeFileSync(join(plan, "plan.md"), "# Fixture plan\n");
  const script = resolve(
    "ai/mzizzi/skills/prepare-feature-branch/scripts/inspect_branch_state.sh",
  );
  const inspect = () =>
    execFileSync("bash", [script, plan], { cwd: f.source, encoding: "utf8" });
  assert.match(inspect(), /ACTION=create/);
  assert.match(inspect(), /PLAN_DIR_DIRTY=yes/);
  assert.match(inspect(), /OTHER_DIRTY=no/);
  git(f.source, "branch", "fixture/skill-port");
  assert.match(inspect(), /ACTION=switch/);
  git(f.source, "switch", "fixture/skill-port");
  assert.match(inspect(), /ACTION=stay/);
  git(f.source, "switch", "main");
  git(f.target, "switch", "fixture/skill-port");
  writeFileSync(join(f.source, "unrelated.txt"), "leave this edit\n");
  const enter = inspect();
  assert.match(enter, /ACTION=enter-worktree/);
  assert.match(enter, /OTHER_DIRTY=yes/);
  assert.ok(enter.includes(`WORKTREE_PATH=${f.target}`));
  assert.equal(
    readFileSync(join(f.source, "unrelated.txt"), "utf8"),
    "leave this edit\n",
  );
  git(f.source, "switch", "-c", "manual-feature");
  const otherPlan = join(f.source, "plans/20261107-other-plan");
  mkdirSync(otherPlan);
  assert.match(
    execFileSync("bash", [script, otherPlan], {
      cwd: f.source,
      encoding: "utf8",
    }),
    /ACTION=judge-current-branch-then-create/,
  );
});

test("ordinary process children do not register worktree tools", () => {
  const previous = process.env.PI_SUBAGENT_CHILD;
  process.env.PI_SUBAGENT_CHILD = "1";
  try {
    worktree({
      registerTool: () => assert.fail("child registered a transition"),
    });
  } finally {
    if (previous === undefined) delete process.env.PI_SUBAGENT_CHILD;
    else process.env.PI_SUBAGENT_CHILD = previous;
  }
});
