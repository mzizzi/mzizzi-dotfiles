import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fixture } from "./worktree-fixture.mjs";

let cli;
let python;
if (process.platform === "linux") {
  try {
    cli = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
    python = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
  } catch {}
}

const subagents = join(
  process.env.HOME,
  ".pi/agent/npm/node_modules/pi-subagents",
);
for (const { race, childRoundTrip } of [
  {},
  { race: true },
  { childRoundTrip: true },
]) {
  test(
    `real Linux terminal ${childRoundTrip ? "completes a local child/supervisor round trip after entry" : race ? "retains late input without false completion" : "enters and returns through real confirmation dialogs"}`,
    {
      skip:
        !cli || !python || (childRoundTrip && !existsSync(subagents))
          ? "Install Pi, pi-subagents, and Python 3 on Linux for PTY checks"
          : false,
      timeout: 30000,
    },
    (t) => {
      const f = fixture(t);
      const agentDir = join(f.dir, "agent");
      mkdirSync(agentDir);
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({
          packages: childRoundTrip ? [subagents] : [],
          lastChangelogVersion: "1.5.0",
          enableInstallTelemetry: false,
          cacheWarming: "off",
          compaction: { enabled: false },
          retry: { enabled: false },
        }),
      );
      if (childRoundTrip) {
        mkdirSync(join(agentDir, "extensions"));
        symlinkSync(
          fileURLToPath(new URL("./fixtures/worktree-cli.js", import.meta.url)),
          join(agentDir, "extensions/provider.js"),
        );
        symlinkSync(
          fileURLToPath(new URL("./fixtures/scripted-response.mjs", import.meta.url)),
          join(agentDir, "extensions/scripted-response.mjs"),
        );
        mkdirSync(join(agentDir, "agents"));
        writeFileSync(
          join(agentDir, "agents/fixture-probe.md"),
          "---\nname: fixture-probe\ndescription: Local scripted child probe.\nmodel: terminal-fixture/local\nthinking: off\ntools: bash, contact_supervisor\n---\nRead the working directory and request the supervisor acknowledgement.\n",
        );
      }
      const config = {
        source: f.source,
        target: f.target,
        agentDir,
        race,
        childRoundTrip,
        hostRoot:
          basename(dirname(realpathSync(cli))) === "bundle"
            ? dirname(dirname(dirname(realpathSync(cli))))
            : dirname(dirname(realpathSync(cli))),
        events: join(f.dir, "terminal-events.jsonl"),
        terminalOutput: join(f.dir, "terminal-output.log"),
        command: [
          cli,
          "--no-extensions",
          "-e",
          fileURLToPath(
            new URL("../extensions/worktree/index.js", import.meta.url),
          ),
          "-e",
          fileURLToPath(new URL("./fixtures/worktree-cli.js", import.meta.url)),
          ...(childRoundTrip ? ["-e", join(subagents, "index.js")] : []),
          "--no-skills",
          "--no-prompt-templates",
          "--no-context-files",
          "--no-mcp",
          "--approve",
          "--model",
          "terminal-fixture/local",
          "--tui-mode",
          "regular",
          "--session-dir",
          join(f.dir, "sessions"),
          "fixture",
        ],
      };
      const configPath = join(f.dir, "terminal-config.json");
      writeFileSync(configPath, JSON.stringify(config));
      const result = spawnSync(
        python,
        [
          fileURLToPath(
            new URL("./fixtures/terminal-driver.py", import.meta.url),
          ),
          configPath,
        ],
        {
          encoding: "utf8",
          timeout: 25000,
        },
      );
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const receipt = JSON.parse(result.stdout);
      const terminal = readFileSync(config.terminalOutput, "utf8");
      assert.equal(receipt.deadlineExceeded, false, terminal.slice(-4000));
      const events = existsSync(config.events)
        ? readFileSync(config.events, "utf8").trim().split("\n").map(JSON.parse)
        : [];
      const completions = events.filter(
        (event) =>
          event.type === "custom" &&
          event.customType === "mzizzi-worktree-completed",
      );
      if (race) {
        assert.equal(receipt.injected, true, terminal.slice(-4000));
        assert.ok(
          events.some(
            (event) =>
              event.type === "input" && event.text === "CANCEL_TERMINAL_INPUT",
          ),
        );
        assert.equal(completions.length, 0, JSON.stringify(events));
      } else {
        assert.equal(receipt.exitCode, 0, terminal.slice(-4000));
        assert.equal(receipt.answers.length, 2);
        assert.deepEqual(
          events
            .filter((event) => event.type === "start" && !event.child)
            .map((event) => event.cwd),
          [f.source, f.target, f.source],
        );
        assert.equal(completions.length, 2, JSON.stringify(events));
        if (childRoundTrip) {
          assert.ok(
            events.some(
              (event) =>
                event.type === "start" && event.child && event.cwd === f.target,
            ),
          );
          assert.ok(
            events.some(
              (event) =>
                event.type === "tool" &&
                event.child &&
                event.name === "bash" &&
                event.text?.trim() === f.target,
            ),
          );
          assert.ok(
            events.some(
              (event) =>
                event.type === "tool" &&
                event.name === "contact_supervisor" &&
                event.text?.includes("PARENT_ACK"),
            ),
          );
          assert.ok(
            events.some(
              (event) =>
                event.type === "tool" &&
                event.name === "subagent_supervisor" &&
                !event.error,
            ),
          );
        }
      }
    },
  );
}
