import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { sameCheckout } from "./git-worktree.js";

export const STATE_TYPE = "mzizzi-worktree-v1";
export const TRANSITIONS = new Set(["EnterWorktree", "ExitWorktree"]);

export function restoreState(manager) {
  const entry = manager
    .getBranch()
    .findLast(
      (item) => item.type === "custom" && item.customType === STATE_TYPE,
    );
  if (!entry) return null;
  const state = entry.data;
  if (
    state?.version !== 1 ||
    !["active", "idle", "pending", "prepared"].includes(state.status) ||
    typeof state.currentCwd !== "string" ||
    !state.current?.gitDir ||
    !state.current?.identity
  )
    throw new Error(
      "Unsupported or corrupt worktree state. Resume a known session; do not guess the origin.",
    );
  if (
    state.status === "pending" &&
    (!state.id ||
      !["enter", "exit"].includes(state.operation) ||
      !["active", "idle"].includes(state.previous?.status) ||
      state.previous.currentCwd !== state.currentCwd ||
      !sameCheckout(state.previous.current, state.current) ||
      !state.target?.identity ||
      !state.destinationCwd)
  )
    throw new Error(
      "Incomplete pending worktree state. Resume a known session.",
    );
  if (state.originalCwd && !state.origin?.identity)
    throw new Error(
      "Worktree origin identity is missing. Resume a known session.",
    );
  if (state.status === "active" && !state.originalCwd)
    throw new Error(
      "Active worktree state has no origin. Resume a known session.",
    );
  if (
    state.status === "prepared" &&
    (!state.id ||
      typeof state.sourceSession !== "string" ||
      (typeof state.sourceLeaf !== "string" && state.sourceLeaf !== null) ||
      !["enter", "exit"].includes(state.operation) ||
      state.completedStatus !==
        (state.operation === "exit" ? "idle" : "active"))
  )
    throw new Error("Incomplete replacement state. Resume the source session.");
  return state;
}

/** Match by call ID on the active branch, never by an arbitrary latest message. */
export function batchRefusal(event, manager) {
  if (event.parentToolCallId) {
    return TRANSITIONS.has(event.toolName)
      ? "Nested worktree transitions are unsupported. Call the tool directly and alone."
      : null;
  }
  const matches = manager
    .getBranch()
    .filter(
      (entry) =>
        entry.type === "message" &&
        entry.message.role === "assistant" &&
        entry.message.content?.some(
          (part) => part.type === "toolCall" && part.id === event.toolCallId,
        ),
    );
  if (matches.length !== 1)
    return "Cannot resolve this tool call to one persisted assistant message; refusing execution.";
  const calls = matches[0].message.content.filter(
    (part) => part.type === "toolCall",
  );
  if (calls.some((call) => TRANSITIONS.has(call.name)) && calls.length !== 1)
    return "Worktree transitions must be the only tool call in a message. This entire batch is blocked; no tool body ran.";
  return null;
}

export async function checkBinding(state, cwd, current) {
  if (!state) return;
  if (
    (await realpath(state.currentCwd)) !== (await realpath(cwd)) ||
    !sameCheckout(state.current, current)
  )
    throw new Error(
      "Worktree state does not match the native cwd. Resume the correct session; do not guess the origin.",
    );
}

/** Uses only public SessionManager methods. The imported host class comes from Pi. */
export function prepareReplacement(SessionManager, source, intent) {
  const sourceFile = source.getSessionFile();
  if (!sourceFile || !existsSync(sourceFile))
    throw new Error("Worktree switching needs a persisted conversation.");
  // Open a separate manager to access the public default-directory predicate. The extension
  // context intentionally exposes a smaller read-only SessionManager interface.
  const opened = SessionManager.open(sourceFile);
  const sessionDir = opened.usesDefaultSessionDir()
    ? undefined
    : source.getSessionDir();
  const leaf = source.getLeafId();
  const next = SessionManager.forkFrom(
    sourceFile,
    intent.destinationCwd,
    sessionDir,
  );
  if (leaf === null) next.resetLeaf();
  else next.branch(leaf);
  const state = {
    version: 1,
    status: "prepared",
    completedStatus: intent.operation === "exit" ? "idle" : "active",
    operation: intent.operation,
    sourceLeaf: leaf,
    id: intent.id,
    originalCwd: intent.operation === "exit" ? null : intent.originalCwd,
    origin: intent.operation === "exit" ? null : intent.origin,
    currentCwd: intent.destinationCwd,
    current: intent.target,
    sourceSession: sourceFile,
    destinationSession: next.getSessionFile(),
  };
  next.appendCustomEntry(STATE_TYPE, state);
  return { file: next.getSessionFile(), state };
}

export function completionText(intent, sessionFile) {
  return [
    `Worktree ${intent.operation === "exit" ? "exit" : "entry"} completed.`,
    `Actual cwd: ${JSON.stringify(intent.destinationCwd)}.`,
    `Checkout: ${intent.target.detached ? "detached HEAD" : JSON.stringify(intent.target.branch)}; ${intent.target.dirty ? "dirty" : "clean"}.`,
    `Replacement session: ${JSON.stringify(sessionFile)}.`,
    `Original cwd: ${JSON.stringify(intent.originalCwd)}. Binding active: ${intent.operation !== "exit"}.`,
    "Continue the interrupted workflow at its next unfinished step, not from the beginning.",
    "Keep the original absolute plan and skill paths. Recheck required tools and destination instructions.",
    "Do not automatically exit after implementation. No checkout or branch was created, removed, cleaned, or copied.",
  ].join("\n");
}
