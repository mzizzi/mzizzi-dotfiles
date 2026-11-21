import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi/agent");
const agentPath = new URL("../../../ai-rendered/pi/packages/mzizzi/agents/delegator.md", import.meta.url);
const agent = readFileSync(agentPath, "utf8");
const prompt = agent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/)?.[1].trim();
if (!prompt) throw new Error(`No delegator prompt in ${agentPath.pathname}`);

mkdirSync(agentDir, { recursive: true });
try {
  writeFileSync(join(agentDir, "APPEND_SYSTEM.md"), prompt + "\n", { flag: "wx" });
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
