import { appendFileSync } from "node:fs";
import { response, scriptedProvider } from "./scripted-response.mjs";

const providerId = "claude-rules-fixture";
export const modelId = `${providerId}/local`;
export const matchingRead = {
  path: "matching/inside.txt",
  text: "MATCHING_FILE_MARKER",
};
export const reads = [
  { path: "outside.txt", text: "OUTSIDE_FILE_MARKER" },
  matchingRead,
];

export default function (pi) {
  const requestLog = process.env.PI_CLAUDE_RULES_REQUEST_LOG;
  let step = 0;
  pi.registerProvider(
    providerId,
    scriptedProvider(
      "Local rules fixture",
      (model, { systemPrompt, messages }) => {
        appendFileSync(
          requestLog,
          JSON.stringify({ systemPrompt, messages }) + "\n",
        );
        const read = reads[step++];
        return response(
          read
            ? [
                {
                  type: "toolCall",
                  id: `rules-read-${step}`,
                  name: "read",
                  arguments: { path: read.path },
                },
              ]
            : [{ type: "text", text: "Rules fixture complete" }],
          model,
        );
      },
    ),
  );
}
