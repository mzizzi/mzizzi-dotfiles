import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { stripVTControlCharacters } from "node:util";
import {
  checkDestination,
  inspectCheckout,
  sameCheckout,
} from "./git-worktree.js";
import {
  STATE_TYPE,
  TRANSITIONS,
  batchRefusal,
  checkBinding,
  completionText,
  prepareReplacement,
  restoreState,
} from "./transition.js";

const COMMAND = "mzizzi-worktree-transition";
const clean = (text) =>
  stripVTControlCharacters(String(text))
    .replace(/[\x00-\x1f\x7f-\x9f]/g, " ")
    .slice(0, 4000);
const result = (text, details = {}, terminate = false) => ({
  content: [{ type: "text", text }],
  details,
  ...(terminate ? { terminate: true } : {}),
});

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function worktree(
  pi,
  loadHost = () => import("@earendil-works/pi-coding-agent"),
) {
  if (process.env.PI_SUBAGENT_CHILD === "1") return;
  let pending = null;
  let state = null;
  let recovery = null;
  let checking = false;
  let retired = false;
  let preparedFile;
  let inputEpoch = 0;
  let inputDuringRun = false;
  let initialUser = false;
  let awaitingCompletion = false;
  let transitioning = false;
  let dispatchTimer;
  let readyOperation = null;

  function stopDispatch() {
    clearTimeout(dispatchTimer);
    dispatchTimer = undefined;
    readyOperation = null;
  }

  function notify(ctx, text, level = "warning") {
    if (ctx.hasUI) ctx.ui.notify(clean(text), level);
  }

  function cancel(ctx, reason) {
    if (!pending) return;
    stopDispatch();
    const previous = pending.previous;
    // Keep the barrier if persistence fails. A half-cancelled intent is unsafe.
    pi.appendEntry(STATE_TYPE, {
      ...previous,
      cancelledTransition: pending.id,
      reason,
    });
    pending.cancelled = true;
    pending = null;
    preparedFile = undefined;
    recovery = null;
    state = previous;
    notify(
      ctx,
      `Worktree switch cancelled: ${reason}. Cwd remains ${ctx.cwd}.`,
    );
  }

  async function restore(event, ctx) {
    stopDispatch();
    pending = null;
    checking = false;
    recovery = null;
    awaitingCompletion = false;
    try {
      state = restoreState(ctx.sessionManager);
      if (state) {
        await checkBinding(state, ctx.cwd, await inspectCheckout(ctx.cwd));
        if (state.status === "pending")
          recovery =
            "A previous switch did not complete. Run /worktree-cancel in this source session before retrying.";
        if (state.status === "prepared") {
          awaitingCompletion =
            event.reason === "resume" &&
            event.previousSessionFile === state.sourceSession;
          recovery = `Replacement awaits a checked completion receipt. Resume the source with pi --session ${JSON.stringify(state.sourceSession)} if completion fails.`;
        }
      } else if (
        ctx.sessionManager
          .getEntries()
          .some(
            (entry) =>
              entry.type === "custom" && entry.customType === STATE_TYPE,
          )
      ) {
        recovery =
          "This history branch has no worktree binding. Resume the correct replacement session; do not guess the origin.";
      }
    } catch (error) {
      recovery = error.message;
    }
    if (recovery && !awaitingCompletion) notify(ctx, recovery, "error");
  }
  pi.on("session_start", restore);
  pi.on("session_tree", restore);

  pi.on("input", (_event, ctx) => {
    inputEpoch++;
    if (!ctx.isIdle()) inputDuringRun = true;
    if (awaitingCompletion) awaitingCompletion = false;
    if (pending) cancel(ctx, "new input arrived");
  });
  pi.on("before_agent_start", (event, ctx) => {
    initialUser = event.messageType === "user";
    if (pending) cancel(ctx, "another agent run started");
  });
  pi.on("message_end", (event, ctx) => {
    // The initiating prompt is expected. Later accepted messages can drain the queue
    // before settlement, so observe them independently of hasPendingMessages().
    if (pending && event.message.role === "custom")
      cancel(ctx, "an extension message arrived");
    if (event.message.role !== "user") return;
    if (initialUser) {
      initialUser = false;
      return;
    }
    inputEpoch++;
    if (!ctx.isIdle()) inputDuringRun = true;
    if (pending) cancel(ctx, "an accepted user message arrived");
  });
  pi.on("tool_call", (event, ctx) => {
    const reason =
      recovery ||
      (pending || checking
        ? "A worktree transition is pending; no other tools may run."
        : null) ||
      batchRefusal(event, ctx.sessionManager);
    if (reason) return { block: true, reason, terminate: true };
  });
  pi.on("user_bash", (_event, ctx) => {
    if (!pending && !checking && !recovery) return;
    notify(
      ctx,
      "Shell execution is blocked until the worktree transition completes or /worktree-cancel succeeds.",
    );
    return {
      result: {
        output: "Worktree transition/recovery blocks shell execution.",
        exitCode: 1,
        cancelled: false,
        truncated: false,
      },
    };
  });
  pi.on("session_before_fork", (_event, ctx) => {
    if (pending) cancel(ctx, "manual session fork");
  });
  pi.on("session_before_tree", (_event, ctx) => {
    if (pending) cancel(ctx, "manual history navigation");
  });
  pi.on("session_before_switch", async (event, ctx) => {
    if (!pending) return;
    if (!preparedFile || event.targetSessionFile !== preparedFile) {
      cancel(ctx, "manual session switch");
      return;
    }
    const intent = pending;
    if (
      ctx.hasPendingMessages() ||
      inputDuringRun ||
      intent.epoch !== inputEpoch
    ) {
      cancel(ctx, "input arrived before replacement");
      return { cancel: true };
    }
    try {
      const { source, target } = await checkDestination(
        ctx.cwd,
        intent.destinationCwd,
        { rootOnly: intent.operation !== "exit" },
      );
      if (
        !sameCheckout(source, intent.current) ||
        !sameCheckout(target, intent.target)
      )
        throw new Error("Checkout identity changed before replacement");
      if (
        pending !== intent ||
        ctx.hasPendingMessages() ||
        intent.epoch !== inputEpoch
      )
        return { cancel: true };
    } catch (error) {
      cancel(ctx, clean(error.message));
      return { cancel: true };
    }
  });
  pi.on("session_shutdown", (event, ctx) => {
    stopDispatch();
    if (pending && (!preparedFile || event.targetSessionFile !== preparedFile))
      cancel(ctx, `session ${event.reason}`);
    retired = true;
  });

  async function schedule(operation, params, signal, ctx) {
    signal?.throwIfAborted();
    if (ctx.mode !== "tui" || !ctx.hasUI)
      throw new Error(
        "Worktree switching supports persisted interactive parent sessions only, not headless/RPC/child sessions.",
      );
    if (!ctx.sessionManager.getSessionFile())
      throw new Error("Worktree switching needs a persisted conversation.");
    if (recovery) throw new Error(recovery);
    if (pending || checking)
      throw new Error("A worktree transition is already pending.");
    if (ctx.hasPendingMessages() || inputDuringRun)
      throw new Error(
        "Queued or new input prevents a worktree switch. Finish that input, then retry.",
      );
    if (
      operation === "enter" &&
      (params.name !== undefined ||
        typeof params.path !== "string" ||
        !params.path.trim())
    )
      throw new Error(
        "Stage A supports only EnterWorktree({path}) for an existing registered worktree. Creation by name is unsupported.",
      );
    if (
      operation === "exit" &&
      (params.action !== "keep" || params.discard_changes !== undefined)
    )
      throw new Error(
        'Stage A supports only ExitWorktree({action:"keep"}). Removal and discard requests are unsupported.',
      );
    state = restoreState(ctx.sessionManager);
    if (operation === "exit" && !state?.originalCwd)
      throw new Error(
        "No active worktree binding; there is no recorded origin to restore.",
      );
    const epoch = inputEpoch;
    checking = true;
    try {
      const path = operation === "exit" ? state.originalCwd : params.path;
      const checked = await checkDestination(ctx.cwd, path, {
        rootOnly: operation !== "exit",
        signal,
      });
      await checkBinding(state, ctx.cwd, checked.source);
      if (operation === "exit" && !sameCheckout(checked.target, state.origin))
        throw new Error(
          "Original checkout identity changed. Keep the worktree and resume a known session.",
        );
      if (
        (await realpath(ctx.cwd)) === (await realpath(checked.destinationCwd))
      ) {
        if (operation === "exit") {
          pi.appendEntry(STATE_TYPE, {
            version: 1,
            status: "idle",
            originalCwd: null,
            origin: null,
            currentCwd: ctx.cwd,
            current: checked.source,
          });
        }
        return result(
          "Already in the requested directory; no session switch needed.",
          {
            cwd: ctx.cwd,
            bindingActive: operation !== "exit" && !!state?.originalCwd,
          },
        );
      }
      const approved = await ctx.ui.confirm(
        "Switch parent worktree?",
        clean(
          `Destination: ${checked.destinationCwd} (${checked.target.dirty ? "dirty" : "clean"}). Confirm that ALL children, nested/background work, interviews, and pending results are finished. If a subagent guard later reveals work, choose Stay. No checkout will be removed.`,
        ),
        { signal },
      );
      signal?.throwIfAborted();
      if (!approved)
        throw new Error("Worktree switch declined; cwd did not change.");
      if (epoch !== inputEpoch || inputDuringRun || ctx.hasPendingMessages())
        throw new Error("New input cancelled worktree scheduling.");
      const previous = state ?? {
        version: 1,
        status: "idle",
        originalCwd: null,
        origin: null,
        currentCwd: ctx.cwd,
        current: checked.source,
      };
      const intent = {
        version: 1,
        status: "pending",
        id: randomUUID(),
        operation,
        epoch,
        previous,
        originalCwd: state?.originalCwd || ctx.cwd,
        origin: state?.origin || checked.source,
        currentCwd: ctx.cwd,
        current: checked.source,
        destinationCwd: checked.destinationCwd,
        target: checked.target,
        sourceSession: ctx.sessionManager.getSessionFile(),
      };
      pi.appendEntry(STATE_TYPE, intent);
      pending = intent;
      return result(
        "Switch scheduled; cwd has not changed. Do not run more tools or restart the skill. Wait for the completion message.",
        {
          transitionId: intent.id,
          sourceCwd: ctx.cwd,
          originalCwd: intent.originalCwd,
          destinationCwd: intent.destinationCwd,
          bindingWasActive: !!state?.originalCwd,
          dirty: intent.target.dirty,
        },
        true,
      );
    } finally {
      checking = false;
    }
  }

  for (const name of TRANSITIONS) {
    pi.registerTool({
      name,
      label: name,
      description:
        name === "EnterWorktree"
          ? "Switch the interactive parent into an existing registered worktree. Call alone, before children start. Wait for completed entry. No creation."
          : "Return to the exact first-entry cwd, keeping all worktrees. Call alone after all child work finishes. No removal.",
      executionMode: "sequential",
      exposure: "model-only",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties:
          name === "EnterWorktree"
            ? {
                path: { type: "string", minLength: 1, maxLength: 4096 },
                name: { type: "string", minLength: 1, maxLength: 200 },
              }
            : {
                action: { type: "string", enum: ["keep", "remove"] },
                discard_changes: { type: "boolean" },
              },
        required: name === "EnterWorktree" ? [] : ["action"],
      },
      async execute(_id, params, signal, _onUpdate, ctx) {
        try {
          return await schedule(
            name === "EnterWorktree" ? "enter" : "exit",
            params,
            signal,
            ctx,
          );
        } catch (error) {
          throw new Error(clean(error.message));
        }
      },
    });
  }

  pi.on("agent_settled", (event, ctx) => {
    if (!pending) {
      inputDuringRun = false;
      return;
    }
    if (event.aborted || ctx.hasPendingMessages() || inputDuringRun) {
      cancel(ctx, event.aborted ? "agent aborted" : "input arrived");
      inputDuringRun = false;
      return;
    }
    if (dispatchTimer !== undefined || readyOperation || transitioning) return;
    pi.sendUserMessage(`/${COMMAND} ${pending.id}`, {
      expandPromptTemplates: true,
    });
  });

  pi.registerCommand(COMMAND, {
    description:
      "Internal worktree transition; needs a live scheduled operation ID",
    handler: async (args, ctx) => {
      const intent = pending;
      const [id, phase, ...extra] = args.trim().split(/\s+/);
      if (!intent || id !== intent.id || extra.length || transitioning) {
        notify(ctx, "Stale or unknown worktree operation; no switch occurred.");
        return;
      }
      if (phase !== "commit") {
        if (
          phase !== undefined ||
          dispatchTimer !== undefined ||
          readyOperation
        ) {
          notify(
            ctx,
            "Stale or duplicate worktree handoff; no switch occurred.",
          );
          return;
        }
        // Return to Pi's deferred settlement drain before replacement. Accepted input
        // behind this handoff must reach its input hooks before any runtime is disposed.
        dispatchTimer = setTimeout(() => {
          dispatchTimer = undefined;
          if (retired || pending !== intent) return;
          readyOperation = intent.id;
          pi.sendUserMessage(`/${COMMAND} ${intent.id} commit`, {
            expandPromptTemplates: true,
          });
        }, 0);
        return;
      }
      if (readyOperation !== intent.id) {
        notify(ctx, "Worktree commit has no live handoff; no switch occurred.");
        return;
      }
      readyOperation = null;
      let nextFile;
      transitioning = true;
      try {
        await ctx.waitForIdle();
        if (
          pending !== intent ||
          intent.epoch !== inputEpoch ||
          ctx.hasPendingMessages() ||
          inputDuringRun
        )
          throw new Error("Source input/state changed before replacement");
        if (ctx.sessionManager.getSessionFile() !== intent.sourceSession)
          throw new Error("Source session changed");
        const { source, target } = await checkDestination(
          ctx.cwd,
          intent.destinationCwd,
          { rootOnly: intent.operation !== "exit" },
        );
        if (
          !sameCheckout(source, intent.current) ||
          !sameCheckout(target, intent.target)
        )
          throw new Error("Checkout identity changed");
        intent.target = target;
        const { SessionManager } = await loadHost();
        if (
          pending !== intent ||
          intent.epoch !== inputEpoch ||
          ctx.hasPendingMessages()
        )
          throw new Error("Input cancelled replacement");
        const next = prepareReplacement(
          SessionManager,
          ctx.sessionManager,
          intent,
        );
        nextFile = next.file;
        preparedFile = next.file;
        const switched = await ctx.switchSession(next.file, {
          withSession: async (fresh) => {
            // Only plain captured data and the replacement context survive teardown.
            if (intent.cancelled)
              throw new Error(
                "Input cancelled the switch before teardown; resume the source session",
              );
            const binding = restoreState(fresh.sessionManager);
            if (binding?.id !== intent.id || binding?.status !== "prepared")
              throw new Error("Replacement binding is missing or incomplete");
            await fresh.sendUserMessage(
              `/mzizzi-worktree-complete ${intent.id}`,
              { expandPromptTemplates: true },
            );
          },
        });
        if (switched.cancelled) {
          cancel(
            ctx,
            `session switch declined; unused prepared transcript: ${next.file}`,
          );
        }
      } catch (error) {
        const reason = clean(error.message);
        if (!retired) {
          cancel(ctx, reason);
          notify(
            ctx,
            `Worktree switch failed: ${reason}.${nextFile ? ` Unused prepared transcript: ${nextFile}.` : ""}`,
            "error",
          );
        } else {
          // No captured session-bound API is safe here. Keep both transcripts for manual recovery.
          throw new Error(
            `Worktree replacement failed: ${reason}. No automatic rollback. Restart with pi --session ${JSON.stringify(intent.sourceSession)} or pi --session ${JSON.stringify(nextFile)}. Check cwd and /worktree-status before continuing.`,
          );
        }
      } finally {
        transitioning = false;
      }
    },
  });
  pi.registerCommand("mzizzi-worktree-complete", {
    description: "Internal receipt for a freshly replaced worktree session",
    handler: async (args, ctx) => {
      const binding = restoreState(ctx.sessionManager);
      if (
        !awaitingCompletion ||
        binding?.status !== "prepared" ||
        binding.id !== args.trim()
      )
        throw new Error(
          "No live worktree completion receipt. Resume the source session shown by /worktree-status.",
        );
      const current = await inspectCheckout(ctx.cwd);
      await checkBinding(binding, ctx.cwd, current);
      const { SessionManager } = await loadHost();
      const source = SessionManager.open(binding.sourceSession);
      const sourceIntent = restoreState(source);
      if (
        !awaitingCompletion ||
        ctx.hasPendingMessages() ||
        source.getLeafId() !== binding.sourceLeaf ||
        sourceIntent?.status !== "pending" ||
        sourceIntent.id !== binding.id
      )
        throw new Error(
          `Input or source changed after transcript preparation. No success continuation. Resume with pi --session ${JSON.stringify(binding.sourceSession)}.`,
        );
      state = { ...binding, current, status: binding.completedStatus };
      pi.appendEntry(STATE_TYPE, state);
      awaitingCompletion = false;
      recovery = null;
      pi.sendMessage(
        {
          customType: "mzizzi-worktree-completed",
          content: completionText(
            { ...state, destinationCwd: ctx.cwd, target: current },
            ctx.sessionManager.getSessionFile(),
          ),
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
  pi.registerCommand("worktree-status", {
    description:
      "Show native cwd, worktree origin, and transition recovery state",
    handler: async (_args, ctx) => {
      notify(
        ctx,
        JSON.stringify(
          {
            cwd: ctx.cwd,
            session: ctx.sessionManager.getSessionFile(),
            state: restoreState(ctx.sessionManager),
            recovery,
          },
          null,
          2,
        ),
        "info",
      );
    },
  });
  pi.registerCommand("worktree-cancel", {
    description:
      "Cancel a pending switch in its source session; never remove a checkout",
    handler: async (_args, ctx) => {
      if (checking) {
        inputEpoch++;
        notify(ctx, "Worktree scheduling cancelled; cwd did not change.");
        return;
      }
      const restored = restoreState(ctx.sessionManager);
      if (!pending && restored?.status === "pending") {
        await checkBinding(restored, ctx.cwd, await inspectCheckout(ctx.cwd));
        pending = restored;
      }
      if (pending) cancel(ctx, "operator cancelled");
      else
        notify(
          ctx,
          recovery || "No pending worktree transition.",
          recovery ? "error" : "info",
        );
    },
  });
}
