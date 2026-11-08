import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import worktree from "../extensions/worktree/index.js";
import tasks from "../extensions/tasks/index.js";
import {
  prepareReplacement,
  restoreState,
  STATE_TYPE,
} from "../extensions/worktree/transition.js";
import { inspectCheckout } from "../extensions/worktree/git-worktree.js";
import { fixture } from "./worktree-fixture.mjs";

let hostPath = process.env.PI_WORKTREE_HOST;
if (!hostPath) {
  try {
    const cli = realpathSync(
      execFileSync("which", ["pi"], { encoding: "utf8" }).trim(),
    );
    hostPath = join(dirname(cli), "index.js");
  } catch {
    /* No installed host: unit tests still run. */
  }
}
const host = hostPath ? await import(pathToFileURL(hostPath)) : undefined;
const hostTest = (name, fn) =>
  test(
    name,
    {
      skip: !host && "Install Pi 1.5.0+ to run real-host contract tests",
      timeout: 30_000,
    },
    fn,
  );

function response(content, model) {
  const message = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    stopReason: content.some((part) => part.type === "toolCall")
      ? "toolUse"
      : "stop",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: Date.now(),
  };
  return {
    result: async () => message,
    async *[Symbol.asyncIterator]() {
      yield { type: "done", reason: message.stopReason, message };
    },
  };
}
const call = (name, args = {}, id = `${name}-${Math.random()}`) => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

async function runtimeHarness(t, f, options = {}) {
  const {
    ModelRuntime,
    SettingsManager,
    SessionManager,
    createAgentSessionServices,
    createAgentSessionFromServices,
    createAgentSessionRuntime,
  } = host;
  const agentDir = join(f.dir, "agent");
  mkdirSync(agentDir, { recursive: true });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  const responses = [];
  modelRuntime.registerProvider("worktree-fixture", {
    api: "openai-completions",
    baseUrl: "http://invalid.test",
    apiKey: "fixture-not-a-real-key",
    streamSimple: (model, context) => {
      options.onRequest?.(context);
      return response(
        responses.shift() ?? [{ type: "text", text: "fixture complete" }],
        model,
      );
    },
    models: [
      {
        id: "local",
        name: "Local fixture",
        reasoning: false,
        input: ["text"],
        contextWindow: 100_000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  });
  const model = modelRuntime.getModel("worktree-fixture", "local");
  const events = [];
  const errors = [];
  const notices = [];
  const seen = [];
  let runtime;
  let failReplacement = false;
  let cancelSwitch = false;
  let onConfirm;
  let transitionFinished;
  const settingsManager = SettingsManager.inMemory({
    packages: options.packages ?? [],
    compaction: { enabled: false },
    retry: { enabled: false },
    cacheWarming: { enabled: false },
    defaultProjectTrust: "never",
  });
  const extension = (pi) => {
    worktree(pi, async () => host);
    tasks(pi);
    pi.registerTool({
      name: "probe",
      label: "probe",
      description: "Check fixture cwd",
      parameters: { type: "object", properties: {} },
      async execute(_id, _args, _signal, _update, ctx) {
        seen.push({
          cwd: ctx.cwd,
          content: readFileSync(join(ctx.cwd, "same.txt"), "utf8"),
        });
        return {
          content: [{ type: "text", text: ctx.cwd }],
          details: {},
          terminate: true,
        };
      },
    });
    pi.on("session_before_switch", () =>
      cancelSwitch ? { cancel: true } : undefined,
    );
    options.extension?.(pi);
  };
  const create = async ({ cwd, sessionManager, sessionStartEvent }) => {
    if (failReplacement)
      throw new Error("fixture replacement construction failure");
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      resourceLoaderReloadOptions: {
        resolveProjectTrust: async () => options.trust === true,
      },
      resourceLoaderOptions: {
        noExtensions: true,
        noPromptTemplates: true,
        noThemes: true,
        extensionFactories: [extension],
        ...options.resources,
      },
    });
    const loaded = services.resourceLoader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    for (const extension of loaded.extensions) {
      const command = extension.commands.get("mzizzi-worktree-transition");
      if (!command) continue;
      const handler = command.handler;
      command.handler = async (args, ctx) => {
        try {
          return await handler(args, ctx);
        } finally {
          if (args.trim().endsWith(" commit")) transitionFinished?.();
        }
      };
    }
    const result = await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      model,
      thinkingLevel: "off",
      tools: [
        "read",
        "write",
        "edit",
        "bash",
        "grep",
        "find",
        "ls",
        "EnterWorktree",
        "ExitWorktree",
        "TaskCreate",
        "TaskList",
        "TaskGet",
        "TaskUpdate",
        "probe",
      ],
    });
    return { ...result, services, diagnostics: [] };
  };
  const source = options.cwd ?? f.source;
  runtime = await createAgentSessionRuntime(create, {
    cwd: source,
    agentDir,
    sessionManager:
      options.manager ?? SessionManager.create(source, join(f.dir, "sessions")),
  });
  const bind = async (session) => {
    session.subscribe((event) => events.push(event));
    await session.bindExtensions({
      mode: "tui",
      uiContext: {
        confirm: async (...args) => (onConfirm ? onConfirm(...args) : true),
        notify: (message) => notices.push(message),
        setWidget() {},
        setStatus() {},
      },
      onError: (error) => errors.push(error),
      commandContextActions: {
        waitForIdle: () => session.waitForIdle(),
        switchSession: (...args) => runtime.switchSession(...args),
        newSession: (...args) => runtime.newSession(...args),
        fork: (...args) => runtime.fork(...args),
        navigateTree: (...args) => session.navigateTree(...args),
        reload: async () => {
          throw new Error("Reload is outside this harness");
        },
      },
    });
  };
  runtime.setRebindSession(bind);
  await bind(runtime.session);
  t.after(() => runtime.dispose());
  return {
    runtime,
    responses,
    events,
    seen,
    errors,
    notices,
    async prompt(content, request = "fixture request") {
      const commandDone = new Promise((resolve) => {
        transitionFinished = resolve;
      });
      const source = runtime.session;
      responses.push(content);
      await source.prompt(request);
      if (restoreState(source.sessionManager)?.status === "pending")
        await commandDone;
      await runtime.session.waitForIdle();
      transitionFinished = undefined;
    },
    failReplacement: () => {
      failReplacement = true;
    },
    cancelSwitch: () => {
      cancelSwitch = true;
    },
    onConfirm: (handler) => {
      onConfirm = handler;
    },
  };
}

hostTest(
  "installed AgentSession rejects mixed batches before all tool bodies, including malformed siblings",
  async (t) => {
    const f = fixture(t);
    const h = await runtimeHarness(t, f);
    for (const calls of [
      [call("EnterWorktree", { path: f.target }), call("probe")],
      [call("probe"), call("EnterWorktree", { path: f.target })],
      [
        call("EnterWorktree", { path: f.target }),
        call("ExitWorktree", { action: "keep" }),
      ],
      [call("unknown"), call("EnterWorktree", { path: f.target })],
      [call("read", {}), call("EnterWorktree", { path: f.target })],
    ]) {
      await h.prompt(calls);
      assert.equal(h.runtime.cwd, f.source);
      assert.equal(h.seen.length, 0);
      assert.equal(restoreState(h.runtime.session.sessionManager), null);
    }
    assert.deepEqual(h.errors, []);
  },
);

hostTest(
  "real replacement enters dirty/detached paths, reloads context, retains tasks/history, hops and exits to a source subdirectory",
  async (t) => {
    const f = fixture(t);
    writeFileSync(join(f.target, "same.txt"), "target\n");
    writeFileSync(join(f.review, "same.txt"), "review\n");
    writeFileSync(join(f.source, "source-only.txt"), "preserve\n");
    writeFileSync(join(f.source, "AGENTS.md"), "SOURCE_RESOURCE_MARKER\n");
    writeFileSync(join(f.target, "AGENTS.md"), "DESTINATION_RESOURCE_MARKER\n");
    const source = join(f.source, "subdir");
    const h = await runtimeHarness(t, f, { cwd: source });
    await h.prompt([
      call("TaskCreate", {
        subject: "Preserved phase",
        description: "Fixture phase",
      }),
    ]);
    const first = h.runtime.session.sessionFile;
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(
      h.runtime.cwd,
      f.target,
      JSON.stringify({
        messages: h.runtime.session.messages,
        errors: h.errors,
        notices: h.notices,
      }),
    );
    assert.notEqual(h.runtime.session.sessionFile, first);
    assert.match(h.runtime.session.systemPrompt, /DESTINATION_RESOURCE_MARKER/);
    assert.doesNotMatch(
      h.runtime.session.systemPrompt,
      /SOURCE_RESOURCE_MARKER/,
    );
    assert.equal(
      restoreState(h.runtime.session.sessionManager).originalCwd,
      source,
    );
    assert.ok(
      h.runtime.session.sessionManager
        .getBranch()
        .some(
          (entry) =>
            entry.type === "custom" && entry.customType === "mzizzi-tasks-v1",
        ),
    );
    await h.prompt([call("probe")]);
    assert.deepEqual(h.seen.at(-1), { cwd: f.target, content: "target\n" });
    await h.prompt([
      call("write", { path: "written.txt", content: "destination only\n" }),
    ]);
    assert.equal(existsSync(join(f.source, "written.txt")), false);
    assert.equal(
      readFileSync(join(f.target, "written.txt"), "utf8"),
      "destination only\n",
    );
    await h.prompt([
      call("read", { path: "same.txt" }),
      call("bash", { command: "pwd" }),
      call("grep", { pattern: "target", path: "same.txt" }),
    ]);
    const results = h.runtime.session.messages.filter(
      (message) => message.role === "toolResult",
    );
    assert.ok(
      results.some(
        (message) =>
          message.toolName === "read" &&
          message.content[0].text.includes("target"),
      ),
    );
    assert.ok(
      results.some(
        (message) =>
          message.toolName === "bash" &&
          message.content[0].text.includes(f.target),
      ),
    );
    assert.ok(
      results.some(
        (message) =>
          message.toolName === "grep" &&
          message.content[0].text.includes("target"),
      ),
    );
    await h.prompt([call("EnterWorktree", { path: f.review })]);
    assert.equal(
      restoreState(h.runtime.session.sessionManager).current.detached,
      true,
    );
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(
      restoreState(h.runtime.session.sessionManager).originalCwd,
      source,
    );
    await h.prompt([call("ExitWorktree", { action: "keep" })]);
    assert.equal(h.runtime.cwd, source);
    assert.equal(
      restoreState(h.runtime.session.sessionManager).originalCwd,
      null,
    );
    assert.ok(
      h.runtime.session.messages.some(
        (message) => message.toolName === "probe",
      ),
    );
    assert.equal(
      readFileSync(join(f.source, "source-only.txt"), "utf8"),
      "preserve\n",
    );
    assert.ok(existsSync(f.target) && existsSync(f.review));
    assert.deepEqual(h.errors, []);
  },
);

hostTest(
  "user-level extension links, package skills and resources survive entry and return",
  async (t) => {
    const f = fixture(t);
    const packagePath = join(f.dir, "user package");
    const skillPath = join(packagePath, "skills/worktree-package-probe");
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(
      join(packagePath, "package.json"),
      JSON.stringify({
        name: "worktree-package-probe",
        pi: { skills: ["./skills"] },
      }),
    );
    writeFileSync(
      join(skillPath, "SKILL.md"),
      "---\nname: worktree-package-probe\ndescription: Check package continuity.\n---\nWORKTREE_PACKAGE_SKILL_MARKER\n",
    );
    writeFileSync(join(skillPath, "resource.txt"), "STABLE_PACKAGE_RESOURCE\n");
    const extensions = join(f.dir, "agent/extensions");
    mkdirSync(extensions, { recursive: true });
    for (const name of ["worktree", "tasks"]) {
      symlinkSync(
        resolve(`config/pi/extensions/${name}`),
        join(extensions, name),
      );
    }
    const requests = [];
    const h = await runtimeHarness(t, f, {
      packages: [packagePath],
      resources: { noExtensions: false, extensionFactories: [] },
      onRequest: (context) =>
        requests.push(
          JSON.stringify(
            context.messages.findLast((message) => message.role === "user")
              ?.content,
          ),
        ),
    });
    await h.prompt(
      [call("EnterWorktree", { path: f.target })],
      "/skill:worktree-package-probe before-entry",
    );
    assert.equal(h.runtime.cwd, f.target);
    assert.ok(
      requests.some(
        (request) =>
          request.includes("WORKTREE_PACKAGE_SKILL_MARKER") &&
          request.includes("before-entry"),
      ),
    );
    assert.ok(h.runtime.session.systemPrompt.includes(skillPath));
    await h.prompt(
      [call("read", { path: join(skillPath, "resource.txt") })],
      "/skill:worktree-package-probe after-entry",
    );
    assert.ok(requests.at(-1).includes("WORKTREE_PACKAGE_SKILL_MARKER"));
    assert.ok(requests.at(-1).includes("after-entry"));
    for (const name of ["EnterWorktree", "ExitWorktree", "TaskList"]) {
      assert.ok(h.runtime.session.getActiveToolNames().includes(name));
    }
    assert.ok(
      h.runtime.session.messages.some(
        (message) =>
          message.role === "toolResult" &&
          message.toolName === "read" &&
          message.content.some((part) =>
            part.text?.includes("STABLE_PACKAGE_RESOURCE"),
          ),
      ),
    );
    await h.prompt([call("ExitWorktree", { action: "keep" })]);
    assert.equal(h.runtime.cwd, f.source);
    await h.prompt([], "/skill:worktree-package-probe after-return");
    assert.ok(requests.at(-1).includes("WORKTREE_PACKAGE_SKILL_MARKER"));
    assert.ok(requests.at(-1).includes("after-return"));
    for (const name of ["EnterWorktree", "ExitWorktree", "TaskList"]) {
      assert.ok(h.runtime.session.getActiveToolNames().includes(name));
    }
    assert.deepEqual(h.errors, []);
  },
);

hostTest(
  "declined switch leaves source active with no success continuation; stale commands do not switch",
  async (t) => {
    const f = fixture(t);
    const h = await runtimeHarness(t, f);
    h.cancelSwitch();
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(h.runtime.cwd, f.source);
    assert.equal(restoreState(h.runtime.session.sessionManager).status, "idle");
    assert.equal(
      h.runtime.session.messages.some(
        (message) => message.customType === "mzizzi-worktree-completed",
      ),
      false,
    );
    await h.runtime.session.prompt("/mzizzi-worktree-transition stale");
    assert.equal(h.runtime.cwd, f.source);
    assert.match(h.notices.at(-1), /Stale/);
    assert.deepEqual(h.errors, []);
  },
);

hostTest(
  "queued input during confirmation cancels intent without moving that input to another checkout",
  async (t) => {
    const f = fixture(t);
    const h = await runtimeHarness(t, f);
    h.onConfirm(async () => {
      await h.runtime.session.prompt("new source input", {
        streamingBehavior: "followUp",
      });
      return true;
    });
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(h.runtime.cwd, f.source);
    assert.equal(restoreState(h.runtime.session.sessionManager), null);
    assert.ok(
      h.runtime.session.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("new source input"),
      ),
    );
    assert.deepEqual(h.errors, []);
  },
);

hostTest(
  "replacement construction failure supplies exact recovery paths and never claims success",
  async (t) => {
    const f = fixture(t);
    const h = await runtimeHarness(t, f);
    h.failReplacement();
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.ok(
      h.errors.some((error) =>
        /No automatic rollback.*pi --session/.test(error.error),
      ),
    );
    assert.equal(
      h.runtime.session.messages.some(
        (message) => message.customType === "mzizzi-worktree-completed",
      ),
      false,
    );
  },
);

hostTest(
  "public SessionManager fork preserves selected branch, custom directory, compaction and task state",
  async (t) => {
    const f = fixture(t);
    const { SessionManager } = host;
    const source = SessionManager.create(
      f.source,
      join(f.dir, "custom-session-dir"),
    );
    const start = source.appendMessage({
      role: "user",
      content: "plan scope",
      timestamp: Date.now(),
    });
    source.appendCustomEntry("mzizzi-tasks-v1", {
      tasks: [{ id: "1", subject: "phase", status: "pending" }],
      nextId: 2,
    });
    source.appendCompaction("preserve plan scope and workflow", start, 100);
    const selected = source.getLeafId();
    source.appendMessage({
      role: "user",
      content: "abandoned branch",
      timestamp: Date.now(),
    });
    source.branch(selected);
    const current = await inspectCheckout(f.source);
    const intent = {
      id: "fixture-id",
      operation: "enter",
      originalCwd: f.source,
      origin: current,
      target: await inspectCheckout(f.target),
      destinationCwd: f.target,
    };
    const next = prepareReplacement(SessionManager, source, intent);
    const reopened = SessionManager.open(next.file);
    assert.equal(reopened.getSessionDir(), source.getSessionDir());
    assert.equal(reopened.getCwd(), f.target);
    assert.ok(
      reopened.getBranch().some((entry) => entry.type === "compaction"),
    );
    assert.ok(
      reopened
        .getBranch()
        .some((entry) => entry.customType === "mzizzi-tasks-v1"),
    );
    assert.equal(
      reopened
        .getBranch()
        .some((entry) => entry.message?.content === "abandoned branch"),
      false,
    );
    assert.equal(restoreState(reopened).id, "fixture-id");
    assert.equal(
      resolve(reopened.getHeader().parentSession),
      source.getSessionFile(),
    );
  },
);

for (const inputSource of ["interactive", "extension"]) {
  hostTest(
    `input accepted during settlement stays in the source (${inputSource})`,
    async (t) => {
      const f = fixture(t);
      let h;
      let injected = false;
      h = await runtimeHarness(t, f, {
        extension: (pi) => {
          pi.on("agent_settled", async () => {
            if (injected) return;
            injected = true;
            if (inputSource === "extension") {
              pi.sendUserMessage("INPUT DURING SETTLEMENT");
            } else {
              await new Promise((resolve) =>
                setTimeout(async () => {
                  await h.runtime.session.prompt("INPUT DURING SETTLEMENT");
                  resolve();
                }, 0),
              );
            }
          });
        },
      });
      const sourceFile = h.runtime.session.sessionFile;
      await h.prompt([call("EnterWorktree", { path: f.target })]);
      assert.equal(h.runtime.cwd, f.source);
      assert.equal(
        restoreState(h.runtime.session.sessionManager).status,
        "idle",
      );
      assert.ok(
        host.SessionManager.open(sourceFile)
          .getBranch()
          .some(
            (entry) =>
              entry.message?.role === "user" &&
              JSON.stringify(entry.message.content).includes(
                "INPUT DURING SETTLEMENT",
              ),
          ),
      );
      assert.equal(
        h.runtime.session.messages.some(
          (message) => message.customType === "mzizzi-worktree-completed",
        ),
        false,
      );
      assert.deepEqual(h.errors, []);
    },
  );
}

hostTest(
  "input after scheduling cancels before replacement and remains in the source transcript",
  async (t) => {
    const f = fixture(t);
    let h;
    let injected = false;
    h = await runtimeHarness(t, f, {
      extension: (pi) => {
        pi.on("tool_result", async (event) => {
          if (event.toolName === "EnterWorktree" && !injected) {
            injected = true;
            await h.runtime.session.prompt("late source input", {
              streamingBehavior: "steer",
            });
          }
        });
      },
    });
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(h.runtime.cwd, f.source);
    assert.equal(restoreState(h.runtime.session.sessionManager).status, "idle");
    assert.ok(
      h.runtime.session.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("late source input"),
      ),
    );
    assert.equal(
      h.runtime.session.messages.some(
        (message) => message.customType === "mzizzi-worktree-completed",
      ),
      false,
    );
  },
);

hostTest(
  "input during a later switch guard cannot produce a false completion receipt",
  async (t) => {
    const f = fixture(t);
    let h;
    let injected = false;
    h = await runtimeHarness(t, f, {
      extension: (pi) => {
        pi.on("session_before_switch", async () => {
          if (injected) return;
          injected = true;
          await h.runtime.session.prompt("input during switch guard");
        });
      },
    });
    const source = h.runtime.session.sessionManager;
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(
      h.runtime.session.messages.some(
        (message) => message.customType === "mzizzi-worktree-completed",
      ),
      false,
    );
    assert.ok(
      source
        .getBranch()
        .some(
          (entry) =>
            entry.message?.role === "user" &&
            JSON.stringify(entry.message.content).includes(
              "input during switch guard",
            ),
        ),
    );
    assert.ok(
      h.errors.some((error) =>
        /resume the source|No automatic rollback/.test(error.error),
      ),
    );
    // Late cancellation can occur after the host commits to teardown. The destination
    // remains fenced in prepared/recovery state, rather than silently continuing.
    assert.equal(
      restoreState(h.runtime.session.sessionManager).status,
      "prepared",
    );
    await h.prompt([call("probe")]);
    assert.equal(h.seen.length, 0);
  },
);

hostTest(
  "default session directories follow destination cwd instead of retaining the source grouping",
  async (t) => {
    const f = fixture(t);
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(f.dir, "default-agent");
    t.after(() => {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    });
    const source = host.SessionManager.create(f.source);
    source.appendMessage({
      role: "user",
      content: "default directory fixture",
      timestamp: Date.now(),
    });
    const current = await inspectCheckout(f.source);
    const next = prepareReplacement(host.SessionManager, source, {
      id: "default-dir",
      operation: "enter",
      originalCwd: f.source,
      origin: current,
      destinationCwd: f.target,
      target: await inspectCheckout(f.target),
    });
    const destination = host.SessionManager.open(next.file);
    assert.equal(destination.usesDefaultSessionDir(), true);
    assert.notEqual(destination.getSessionDir(), source.getSessionDir());
    assert.ok(next.file.startsWith(process.env.PI_CODING_AGENT_DIR));
  },
);

for (const trusted of [false, true]) {
  hostTest(
    `replacement honors destination project trust (${trusted ? "accept" : "decline"})`,
    async (t) => {
      const f = fixture(t);
      mkdirSync(join(f.target, ".pi"));
      writeFileSync(
        join(f.target, ".pi/APPEND_SYSTEM.md"),
        "TRUSTED_DESTINATION_RESOURCE\n",
      );
      const h = await runtimeHarness(t, f, { trust: trusted });
      await h.prompt([call("EnterWorktree", { path: f.target })]);
      assert.equal(h.runtime.cwd, f.target);
      assert.equal(
        h.runtime.session.systemPrompt.includes("TRUSTED_DESTINATION_RESOURCE"),
        trusted,
      );
      assert.deepEqual(h.errors, []);
    },
  );
}

hostTest(
  "extension loads through Pi's real file loader without extra dependencies",
  async (t) => {
    const f = fixture(t);
    const h = await runtimeHarness(t, f, {
      resources: {
        noExtensions: false,
        additionalExtensionPaths: [
          resolve("config/pi/extensions/worktree/index.js"),
        ],
        extensionFactories: [],
      },
    });
    assert.ok(h.runtime.session.getActiveToolNames().includes("EnterWorktree"));
    // Exercise the file-loaded extension's dynamic host import as well as discovery.
    await h.prompt([call("EnterWorktree", { path: f.target })]);
    assert.equal(
      h.runtime.cwd,
      f.target,
      JSON.stringify({
        messages: h.runtime.session.messages,
        errors: h.errors,
        notices: h.notices,
      }),
    );
    assert.deepEqual(h.errors, []);
  },
);
