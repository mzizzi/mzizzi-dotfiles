import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const stateScript = fileURLToPath(
  new URL("../shell/state-dir.sh", import.meta.url),
);

// A fake filesystem root with a home laid out like the image's; tests that need the mount create it.
function temporaryRoot(t) {
  const root = mkdtempSync(join(tmpdir(), "state-dir-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home/agent");
  for (const dir of [".claude", ".pi/agent", ".deepagents/.state"]) {
    mkdirSync(join(home, dir), { recursive: true });
  }
  writeFileSync(join(home, ".claude/.credentials.json"), "placeholder\n");
  return { root, home };
}

function sourceScript({ root, home }) {
  const output = execFileSync(
    "bash",
    [
      "--norc",
      "--noprofile",
      "-c",
      `. "$1"; printf '%s\\n' "\${HISTFILE-unset}" "\${HISTSIZE-unset}" "\${CLAUDE_CONFIG_DIR-unset}" "$PROMPT_COMMAND"; shopt -q histappend && echo histappend`,
      "bash",
      stateScript,
    ],
    {
      env: {
        PATH: process.env.PATH,
        HOME: home,
        AGENT_LAB_MOUNT_ROOT: root,
      },
      encoding: "utf8",
    },
  );
  const [histfile, histsize, claudeConfigDir, promptCommand, histappend] =
    output.trimEnd().split("\n");
  return { histfile, histsize, claudeConfigDir, promptCommand, histappend };
}

test("a mounted state dir receives history, Claude, dcode and pi state", (t) => {
  const { root, home } = temporaryRoot(t);
  const stateDir = join(root, "c/Users/someone/.sandbox-state/agent-lab");
  mkdirSync(stateDir, { recursive: true });
  const piSessions = join(home, ".pi/agent/sessions");
  mkdirSync(join(piSessions, "project"), { recursive: true });
  writeFileSync(join(piSessions, "project/session.jsonl"), "earlier\n");

  // A second shell finds the database and symlinks from the first already in place.
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.deepEqual(sourceScript({ root, home }), {
      histfile: join(stateDir, "bash/history"),
      histsize: "-1",
      claudeConfigDir: join(stateDir, "claude"),
      promptCommand: "history -a",
      histappend: "histappend",
    });
  }

  assert.equal(
    readFileSync(join(stateDir, "claude/.credentials.json"), "utf8"),
    "placeholder\n",
  );
  const db = join(stateDir, "deepagents/sessions.db");
  const header = readFileSync(db);
  // Bytes 18 and 19 of a SQLite header hold the file format versions; 2 means WAL mode.
  assert.deepEqual([header[18], header[19]], [2, 2]);
  assert.equal(readlinkSync(join(home, ".deepagents/.state/sessions.db")), db);

  assert.ok(lstatSync(piSessions).isSymbolicLink());
  assert.equal(readlinkSync(piSessions), join(stateDir, "pi/sessions"));
  assert.equal(
    readFileSync(join(stateDir, "pi/sessions/project/session.jsonl"), "utf8"),
    "earlier\n",
  );
});

test("without a mounted state dir only history appending is set up", (t) => {
  const { root, home } = temporaryRoot(t);
  assert.deepEqual(sourceScript({ root, home }), {
    histfile: "unset",
    histsize: "unset",
    claudeConfigDir: "unset",
    promptCommand: "history -a",
    histappend: "histappend",
  });
  assert.ok(!existsSync(join(home, ".deepagents/.state/sessions.db")));
  assert.ok(!existsSync(join(home, ".pi/agent/sessions")));
});
