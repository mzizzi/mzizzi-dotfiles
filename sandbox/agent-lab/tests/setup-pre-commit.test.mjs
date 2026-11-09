import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const setupScript = fileURLToPath(
  new URL("../bin/setup-pre-commit.sh", import.meta.url),
);
const hasPreCommit = spawnSync("pre-commit", ["--version"]).status === 0;

test(
  "startup installs working hooks and tolerates repeated starts",
  {
    skip: !hasPreCommit && "pre-commit must be installed",
  },
  (t) => {
    const temporary = mkdtempSync(join(tmpdir(), "setup-pre-commit-"));
    t.after(() => rmSync(temporary, { recursive: true, force: true }));
    const checkout = join(temporary, "checkout with spaces");
    const script = join(checkout, "sandbox/agent-lab/bin/setup-pre-commit.sh");
    mkdirSync(dirname(script), { recursive: true });
    copyFileSync(setupScript, script);
    execFileSync("git", ["init", checkout], { stdio: "pipe" });
    writeFileSync(
      join(checkout, ".pre-commit-config.yaml"),
      `default_install_hook_types: [pre-commit, pre-push]
default_stages: [pre-commit, pre-push]
repos:
  - repo: local
    hooks:
      - id: check-fixture
        name: check fixture
        entry: node check.cjs
        language: system
        pass_filenames: false
        always_run: true
`,
    );
    mkdirSync(join(checkout, "ai-rendered"));
    writeFileSync(join(checkout, "ai-rendered/result.txt"), "Rendered.\n");
    writeFileSync(
      join(checkout, "check.cjs"),
      `const fs = require("node:fs");
if (process.env.CHECK_FAIL || fs.readFileSync("ai-rendered/result.txt", "utf8") !== "Rendered.\\n") process.exit(1);
`,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      execFileSync("bash", [script], { cwd: tmpdir(), stdio: "pipe" });
    }
    for (const hook of ["pre-commit", "pre-push"]) {
      assert.ok(existsSync(join(checkout, `.git/hooks/${hook}`)));
    }
    execFileSync("git", ["add", "."], { cwd: checkout });
    const commit = [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "Test hooks",
    ];
    execFileSync("git", commit, { cwd: checkout, stdio: "pipe" });
    assert.equal(
      readFileSync(join(checkout, "ai-rendered/result.txt"), "utf8"),
      "Rendered.\n",
    );
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: checkout,
      encoding: "utf8",
    });
    const failed = spawnSync("git", commit, {
      cwd: checkout,
      env: { ...process.env, CHECK_FAIL: "1" },
      encoding: "utf8",
    });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.equal(
      execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: checkout,
        encoding: "utf8",
      }),
      head,
    );
  },
);
