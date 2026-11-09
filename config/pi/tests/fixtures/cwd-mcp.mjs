import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const logPath = process.argv[2];
const log = (event) =>
  appendFileSync(
    logPath,
    `${JSON.stringify({ event, cwd: process.cwd(), pid: process.pid })}\n`,
  );
log("start");
const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case "initialize":
      result = {
        protocolVersion: request.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "cwd-probe", version: "1.0.0" },
      };
      break;
    case "tools/list":
      result = {
        tools: [
          {
            name: "probe",
            description: "Read the fixture's working directory and same.txt.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ],
      };
      break;
    case "tools/call":
      result = {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              cwd: process.cwd(),
              pid: process.pid,
              text: readFileSync(join(process.cwd(), "same.txt"), "utf8"),
            }),
          },
        ],
      };
      break;
    default:
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } })}\n`,
      );
      return;
  }
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`,
  );
});
const stop = () => {
  log("stop");
  process.exit(0);
};
input.on("close", stop);
process.on("SIGTERM", stop);
