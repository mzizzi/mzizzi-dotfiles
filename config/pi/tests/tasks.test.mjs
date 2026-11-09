import assert from "node:assert/strict";
import test from "node:test";
import tasks from "../extensions/tasks/index.js";

function harness(entries = [], hasUI = true) {
  const handlers = new Map();
  const tools = new Map();
  const commands = new Map();
  let widget;
  let failSave = false;
  const ctx = {
    hasUI,
    sessionManager: { getBranch: () => entries },
    ui: {
      setWidget: (_key, lines) => {
        widget = lines;
      },
      notify: (text) => {
        ctx.notification = text;
      },
    },
  };
  tasks({
    on: (name, handler) => handlers.set(name, handler),
    registerTool: (tool) => tools.set(tool.name, tool),
    registerCommand: (name, command) => commands.set(name, command),
    appendEntry: (customType, data) => {
      if (failSave) throw new Error("disk full");
      entries.push({ type: "custom", customType, data });
    },
  });
  const call = (name, params = {}, signal) =>
    tools.get(name).execute("test", params, signal, undefined, ctx);
  const create = (subject = "Check the code") =>
    call("TaskCreate", { subject, description: "Tests pass." });
  const event = (name, value = {}) => handlers.get(name)(value, ctx);
  event("session_start");
  return {
    tools,
    handlers,
    commands,
    ctx,
    entries,
    call,
    create,
    event,
    get widget() {
      return widget;
    },
    failSave: () => {
      failSave = true;
    },
  };
}

const text = (result) => result.content[0].text;

test("registers only four sequential tools without execution or subagent hooks", () => {
  const h = harness();
  assert.deepEqual(
    [...h.tools.keys()],
    ["TaskCreate", "TaskList", "TaskGet", "TaskUpdate"],
  );
  assert.deepEqual(
    [...h.handlers.keys()],
    ["session_start", "session_tree", "context"],
  );
  for (const tool of h.tools.values()) {
    assert.equal(tool.executionMode, "sequential");
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.equal(
    h.tools.get("TaskCreate").parameters.properties.agentType,
    undefined,
  );
});

test("TaskCreate describes explicit requests or long-horizon work, not all multi-step work", () => {
  const description = harness().tools.get("TaskCreate").description;
  assert.match(description, /only for explicit task-tracking requests or long-horizon work/);
  assert.match(description, /Skip routine short work/);
  assert.doesNotMatch(description, /Create a task for multi-step work/);
});

test("creates, lists, gets, updates, and deletes tasks without recycling IDs", async () => {
  const h = harness();
  assert.equal(text(await h.call("TaskList")), "No tasks.");
  await h.create();
  assert.match(text(await h.call("TaskList")), /#1 \[pending\] Check the code/);
  await h.call("TaskUpdate", {
    taskId: "1",
    status: "in_progress",
    activeForm: "Checking code",
  });
  assert.match(h.widget.join("\n"), /Checking code/);
  const task = JSON.parse(text(await h.call("TaskGet", { taskId: "1" })));
  assert.equal(task.status, "in_progress");
  await h.call("TaskUpdate", { taskId: "1", status: "completed" });
  assert.match(h.widget[0], /1\/1 completed/);
  await h.call("TaskUpdate", { taskId: "1", status: "deleted" });
  assert.equal(h.widget, undefined);
  assert.match(text(await h.create()), /#2/);
  await assert.rejects(h.call("TaskGet", { taskId: "missing" }), /not found/);
  await assert.rejects(
    h.call("TaskUpdate", { taskId: "missing" }),
    /not found/,
  );
});

test("keeps bidirectional dependencies, warnings, and deletion cleanup", async () => {
  const h = harness();
  await h.create("First");
  await h.create("Second");
  await h.call("TaskUpdate", { taskId: "2", addBlockedBy: ["1"] });
  assert.deepEqual(
    JSON.parse(text(await h.call("TaskGet", { taskId: "1" }))).blocks,
    ["2"],
  );
  assert.match(
    text(await h.call("TaskUpdate", { taskId: "2", status: "in_progress" })),
    /Open blockers: #1/,
  );
  assert.match(
    text(await h.call("TaskUpdate", { taskId: "2", addBlocks: ["1"] })),
    /cycle/,
  );
  assert.match(
    text(await h.call("TaskUpdate", { taskId: "2", addBlocks: ["2", "99"] })),
    /blocks itself[\s\S]*does not exist/,
  );
  await h.call("TaskUpdate", { taskId: "1", status: "deleted" });
  assert.deepEqual(
    JSON.parse(text(await h.call("TaskGet", { taskId: "2" }))).blockedBy,
    ["2"],
  );
});

test("restores immutable snapshots on reload, resume, fork, and tree navigation", async () => {
  const h = harness();
  await h.create();
  const first = structuredClone(h.entries);
  await h.call("TaskUpdate", { taskId: "1", status: "completed" });
  assert.equal(first[0].data.tasks[0].status, "pending");
  assert.equal(h.entries[0].data.tasks[0].status, "pending");
  for (const reason of ["reload", "resume", "fork"]) {
    const restored = harness(structuredClone(first));
    restored.event("session_start", { reason });
    assert.match(text(await restored.call("TaskList")), /\[pending\]/);
  }
  h.entries.splice(1);
  h.event("session_tree");
  assert.match(text(await h.call("TaskList")), /\[pending\]/);
  h.entries.splice(0);
  h.event("session_start", { reason: "new" });
  assert.equal(text(await h.call("TaskList")), "No tasks.");
});

test("rolls back failed persistence and leaves cancelled calls unchanged", async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    h.call("TaskCreate", { subject: "No", description: "" }, controller.signal),
    /abort/i,
  );
  assert.equal(h.entries.length, 0);
  h.failSave();
  await assert.rejects(h.create(), /disk full/);
  assert.equal(text(await h.call("TaskList")), "No tasks.");
});

test("bounds widget and reminder output, avoids persisted reminders, and supports headless mode", async () => {
  const h = harness();
  const messages = [{ role: "user", content: "Work" }];
  assert.equal(h.event("context", { messages }), undefined);
  for (let i = 0; i < 12; i++) await h.create(`Task ${i}`);
  assert.equal(h.widget.length, 7);
  const reminder = h.event("context", { messages });
  assert.equal(messages.length, 1);
  assert.match(reminder.messages.at(-1).content, /2 more/);
  assert.equal(h.event("context", reminder).messages.length, 2);
  assert.equal(h.entries.length, 12);
  await h.commands.get("tasks").handler("", h.ctx);
  assert.match(h.ctx.notification, /#12/);
  const headless = harness([], false);
  await headless.create();
  await headless.call("TaskUpdate", { taskId: "1", status: "in_progress" });
  assert.equal(headless.widget, undefined);
});

test("removes terminal controls from visible titles", async () => {
  const h = harness();
  await h.create("First\n\u001b[31mred\u001b[0m");
  assert.match(h.widget[1], /First red/);
  assert.doesNotMatch(h.widget.join("\n"), /\u001b/);
});

test("rejects terminal controls in dependency IDs without changing stored state", async () => {
  const h = harness();
  await h.create();
  const pattern = new RegExp(
    h.tools.get("TaskUpdate").parameters.properties.taskId.pattern,
  );
  for (const id of ["\nFAKE TASK", "\u001b[31m", "0", "-1", "1.2"]) {
    assert.equal(pattern.test(id), false);
    await assert.rejects(
      h.call("TaskUpdate", { taskId: "1", addBlockedBy: [id] }),
      /positive decimal/,
    );
  }
  assert.deepEqual(
    JSON.parse(text(await h.call("TaskGet", { taskId: "1" }))).blockedBy,
    [],
  );
  assert.equal(h.entries.length, 1);
});

test("caps accumulated dependencies and rolls back overflow updates", async () => {
  const h = harness();
  await h.create();
  const ids = Array.from({ length: 100 }, (_, index) => String(index + 100));
  await h.call("TaskUpdate", { taskId: "1", addBlockedBy: ids });
  assert.match(h.widget[1], /\+95 more/);
  await assert.rejects(
    h.call("TaskUpdate", {
      taskId: "1",
      subject: "Changed",
      addBlockedBy: ["999"],
    }),
    /100-blockedBy limit/,
  );
  const task = JSON.parse(text(await h.call("TaskGet", { taskId: "1" })));
  assert.equal(task.blockedBy.length, 100);
  assert.equal(task.subject, "Check the code");
  await h.call("TaskUpdate", { taskId: "1", addBlockedBy: ids });
  assert.equal(
    JSON.parse(text(await h.call("TaskGet", { taskId: "1" }))).blockedBy.length,
    100,
  );
});

test("limits multibyte tool output by bytes with a truncation notice", async () => {
  const h = harness();
  for (let index = 0; index < 100; index++) await h.create("界".repeat(200));
  const output = text(await h.call("TaskList"));
  assert.ok(Buffer.byteLength(output) < 50 * 1024);
  assert.match(output, /Output truncated at 48 KiB/);
  assert.doesNotMatch(output, /\ufffd/);
  assert.equal(
    JSON.parse(text(await h.call("TaskGet", { taskId: "100" }))).subject,
    "界".repeat(200),
  );
});

test("enforces the task cap and suppresses reminders for completed work", async () => {
  const h = harness();
  await h.create();
  await h.call("TaskUpdate", { taskId: "1", status: "completed" });
  assert.equal(h.event("context", { messages: [] }), undefined);
  for (let i = 1; i < 100; i++) await h.create();
  await assert.rejects(h.create(), /Task limit reached/);
  await h.call("TaskUpdate", { taskId: "1", status: "deleted" });
  assert.match(text(await h.create()), /#101/);
});
