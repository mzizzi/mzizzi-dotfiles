export function scriptedProvider(name, streamSimple) {
  return {
    api: "openai-completions",
    baseUrl: "http://invalid.test",
    apiKey: "fixture-not-a-real-key",
    streamSimple,
    models: [
      {
        id: "local",
        name,
        reasoning: false,
        input: ["text"],
        contextWindow: 100_000,
        maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    ],
  };
}

export function response(content, model) {
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
