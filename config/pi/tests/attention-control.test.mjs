import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import attentionControl from "../extensions/attention-control/index.js";

function loadHandler(eventName = "context_with_system") {
  const handlers = new Map();
  attentionControl({
    on(event, callback) {
      handlers.set(event, callback);
    },
  });
  return handlers.get(eventName);
}

test("adds the complete bundled style without replacing other system sections", () => {
  const handler = loadHandler("before_agent_start");
  const event = {
    systemPrompt: "Existing system instructions.",
    systemPromptOptions: { sections: { other: "Keep this section." } },
  };
  handler(event);

  assert.deepEqual(event.systemPromptOptions.sections, {
    other: "Keep this section.",
    attention_control: readFileSync(
      new URL("../extensions/attention-control/style.md", import.meta.url),
      "utf8",
    ),
  });
  assert.equal(event.systemPrompt, "Existing system instructions.");
  handler(event);
  assert.equal(Object.keys(event.systemPromptOptions.sections).length, 2);
});

test("the bundled Pi style limits task tracking to explicit requests or long-horizon work", () => {
  const style = readFileSync(
    new URL("../extensions/attention-control/style.md", import.meta.url),
    "utf8",
  );
  assert.match(style, /## Task tracking/);
  assert.match(style, /only when the user explicitly requests task tracking/);
  assert.match(style, /long-horizon work with multiple substantial phases/);
  assert.match(style, /persistent state across interruptions or context compaction/);
  assert.match(style, /Skip task tools for questions, short investigations, small edits, and routine edit-and-test work/);
  assert.match(style, /Multiple steps, files, or tool calls alone do not justify task tracking/);
  assert.match(style, /When unsure, skip task tools/);
  assert.doesNotMatch(style, /If the harness has a task tool, use it for multi-step work/);
});

test("adds the style to a forced system prompt and enables the reminder", () => {
  const handler = loadHandler("before_agent_start");
  const event = {
    systemPrompt: "Forced project policy.",
    systemPromptOptions: {
      forceSystemPrompt: "Forced project policy.",
      sections: { other: "Keep this section." },
    },
  };
  handler(event);

  assert.equal(
    event.systemPromptOptions.forceSystemPrompt,
    "Forced project policy.\n\n" +
      readFileSync(
        new URL("../extensions/attention-control/style.md", import.meta.url),
        "utf8",
      ),
  );
  assert.deepEqual(event.systemPromptOptions.sections, {
    other: "Keep this section.",
  });
  const reminder = loadHandler()(
    { messages: [] },
    { getSystemPrompt: () => event.systemPromptOptions.forceSystemPrompt },
  );
  assert.equal(
    reminder.messages.at(-1).customType,
    "attention-control-reminder",
  );
});

test("an inline reference to the heading does not suppress style injection", () => {
  const event = {
    systemPrompt: "Preserve the `# Attention Control` heading.",
    systemPromptOptions: { sections: {} },
  };
  loadHandler("before_agent_start")(event);
  assert.match(
    event.systemPromptOptions.sections.attention_control,
    /^# Attention Control$/m,
  );
  assert.equal(
    loadHandler()(
      { messages: [] },
      { getSystemPrompt: () => event.systemPrompt },
    ),
    undefined,
  );
});

test("does not duplicate a style already present in APPEND_SYSTEM.md", () => {
  const handler = loadHandler("before_agent_start");
  const event = {
    systemPrompt:
      "<addendum>\n# Attention Control\nExisting style.\n</addendum>",
    systemPromptOptions: { sections: {} },
  };
  handler(event);
  assert.deepEqual(event.systemPromptOptions.sections, {});
});

const activeContext = {
  getSystemPrompt: () =>
    "<addendum>\n# Attention Control\nStyle instructions.\n</addendum>",
};

const userMessage = { role: "user", content: "Check this code.", timestamp: 1 };

test("adds a hidden reminder after the conversation without changing existing messages", () => {
  const handler = loadHandler();
  const messages = [
    { role: "system", content: "System instructions.", timestamp: 0 },
    userMessage,
    {
      role: "toolResult",
      toolCallId: "read-1",
      toolName: "read",
      content: [{ type: "text", text: "file contents" }],
      isError: false,
      timestamp: 2,
    },
  ];
  const original = structuredClone(messages);
  const result = handler({ messages }, activeContext);

  assert.deepEqual(messages, original);
  assert.deepEqual(result.messages.slice(0, -1), original);
  assert.equal(result.messages[0], messages[0]);
  const { content, timestamp, ...metadata } = result.messages.at(-1);
  assert.deepEqual(metadata, {
    role: "custom",
    customType: "attention-control-reminder",
    display: false,
  });
  assert.match(content, /^Attention Control is active\./);
  assert.match(content, /keep prose short and literal/);
  assert.match(content, /finish the work you can do/);
  assert.match(content, /when the user asks or safety needs it/);
  assert.equal(typeof timestamp, "number");
});

test("does not inject a reminder when Attention Control is absent", () => {
  const handler = loadHandler();
  assert.equal(
    handler(
      { messages: [userMessage] },
      { getSystemPrompt: () => "Other instructions." },
    ),
    undefined,
  );
});

test("adds one reminder per request without accumulating reminders in session messages", () => {
  const handler = loadHandler();
  const messages = [userMessage];

  for (let request = 0; request < 3; request++) {
    const result = handler({ messages }, activeContext);
    assert.equal(
      result.messages.filter(
        (message) => message.customType === "attention-control-reminder",
      ).length,
      1,
    );
    assert.deepEqual(messages, [userMessage]);
  }
});
