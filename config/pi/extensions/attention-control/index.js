import { readFileSync } from "node:fs";

const STYLE = readFileSync(new URL("./style.md", import.meta.url), "utf8");
const STYLE_HEADING = /^# Attention Control\r?$/m;

const REMINDER =
  "Attention Control is active. Follow its guidelines: lead with the answer, keep prose short and literal, " +
  "skip preamble and recaps, and finish the work you can do rather than handing it back to the user. " +
  "Give more detail when the user asks or safety needs it.";

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function attentionControl(pi) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;

  pi.on("before_agent_start", (event) => {
    if (STYLE_HEADING.test(event.systemPrompt)) return;

    if (event.systemPromptOptions.forceSystemPrompt !== undefined) {
      event.systemPromptOptions.forceSystemPrompt += `\n\n${STYLE}`;
    } else {
      event.systemPromptOptions.sections.attention_control = STYLE;
    }
  });

  pi.on("context_with_system", (event, ctx) => {
    if (!STYLE_HEADING.test(ctx.getSystemPrompt())) return;

    return {
      messages: [
        ...event.messages,
        {
          role: "custom",
          customType: "attention-control-reminder",
          content: REMINDER,
          display: false,
          timestamp: Date.now(),
        },
      ],
    };
  });
}
