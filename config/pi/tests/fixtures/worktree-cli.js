import { appendFileSync, readFileSync } from "node:fs";
import { response } from "./scripted-response.mjs";

export default function (pi) {
  const config = JSON.parse(
    readFileSync(process.env.PI_WORKTREE_TERMINAL_CONFIG, "utf8"),
  );
  const log = (event) =>
    appendFileSync(config.events, `${JSON.stringify(event)}\n`);
  let cwd;
  let finished = false;
  pi.on("session_start", (_event, ctx) => {
    cwd = ctx.cwd;
    log({
      type: "start",
      cwd,
      child: process.env.PI_SUBAGENT_CHILD === "1",
      pid: process.pid,
      file: ctx.sessionManager.getSessionFile(),
    });
  });
  pi.on("ui_prompt_start", (event) =>
    log({ type: "dialog", title: event.title }),
  );
  pi.on("tool_execution_end", (event) =>
    log({
      type: "tool",
      cwd,
      child: process.env.PI_SUBAGENT_CHILD === "1",
      name: event.toolName,
      error: event.isError,
      text: event.result?.content
        ?.filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .slice(0, 5000),
    }),
  );
  pi.on("input", (event) => log({ type: "input", text: event.text }));
  pi.on("session_before_switch", async () => {
    if (!config.race) return;
    log({ type: "late-guard" });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  pi.on("message_end", (event) => {
    if (event.message.role === "custom")
      log({
        type: "custom",
        customType: event.message.customType,
        content: event.message.content,
      });
    if (event.message.role === "assistant") {
      const text = event.message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (text.includes("TERMINAL_FIXTURE_COMPLETE")) finished = true;
    }
  });
  pi.on("agent_settled", (_event, ctx) => {
    if (finished) ctx.shutdown();
  });
  pi.registerProvider("terminal-fixture", {
    api: "openai-completions",
    baseUrl: "http://invalid.test",
    apiKey: "fixture-not-a-real-key",
    models: [
      {
        id: "local",
        name: "Local terminal fixture",
        reasoning: false,
        input: ["text"],
        contextWindow: 100000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
    streamSimple(model, context) {
      const messages = JSON.stringify(context.messages);
      const cancelled = messages.includes("CANCEL_TERMINAL_INPUT");
      const returned =
        cwd === config.source && messages.includes("Worktree exit completed.");
      let content =
        cancelled || returned
          ? [{ type: "text", text: "TERMINAL_FIXTURE_COMPLETE" }]
          : [
              {
                type: "toolCall",
                id: `transition-${Date.now()}`,
                name: cwd === config.source ? "EnterWorktree" : "ExitWorktree",
                arguments:
                  cwd === config.source
                    ? { path: config.target }
                    : { action: "keep" },
              },
            ];
      if (config.childRoundTrip && !cancelled && !returned) {
        const result = (name) =>
          context.messages.findLast(
            (message) =>
              message.role === "toolResult" && message.toolName === name,
          );
        const call = (name, args) => [
          {
            type: "toolCall",
            id: `${name}-${Date.now()}`,
            name,
            arguments: args,
          },
        ];
        if (process.env.PI_SUBAGENT_CHILD === "1") {
          if (!result("bash")) content = call("bash", { command: "pwd" });
          else if (!result("contact_supervisor"))
            content = call("contact_supervisor", {
              reason: "need_decision",
              message: "LOCAL_CHILD_REQUEST",
            });
          else
            content = [
              {
                type: "text",
                text: `CHILD_WORKTREE_COMPLETE ${cwd} ${JSON.stringify(result("contact_supervisor").content)}`,
              },
            ];
        } else if (cwd === config.target) {
          const visible = context.messages
            .map((message) =>
              typeof message.content === "string"
                ? message.content
                : message.content
                    ?.filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n"),
            )
            .join("\n");
          const request = visible.match(/replyTo:\s*"([a-f0-9-]{36})"/);
          if (!result("subagents_enable"))
            content = call("subagents_enable", {});
          else if (!result("subagent"))
            content = call("subagent", {
              agent: "fixture-probe",
              task: "Check cwd, ask the supervisor, and return the acknowledged result.",
              cwd,
              async: true,
              options: {
                context: "fresh",
                acceptance: { level: "none", reason: "read-only fixture" },
              },
            });
          else if (request && !result("subagent_supervisor"))
            content = call("subagent_supervisor", {
              action: "reply",
              replyTo: request[1],
              message: "PARENT_ACK",
            });
          else if (messages.includes("CHILD_WORKTREE_COMPLETE"))
            content = call("ExitWorktree", { action: "keep" });
          else content = [{ type: "text", text: "WAITING_FOR_CHILD" }];
        }
      }
      return response(content, model);
    },
  });
}
