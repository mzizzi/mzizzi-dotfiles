#!/usr/bin/env node
// Regression checks for run_review.mjs.
//
// Usage: node test_run_review.mjs     (exits non-zero if any case fails)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "run_review.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "run-review-test-"));
const home = path.join(tmp, "home");
const plugin = path.join(home, "plug");
const repo = path.join(tmp, "repo");
const promptLog = path.join(tmp, "prompts.txt");

const write = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
};

// Stubs standing in for the codex plugin's lib modules. runAppServerTurn records the prompt,
// model and effort it was handed, which is what the assertions read.
write(
  path.join(plugin, "scripts", "lib", "git.mjs"),
  `export function ensureGitRepository() {}
export function getRepoRoot() { return process.env.TEST_REPO; }\n`
);
write(
  path.join(plugin, "scripts", "lib", "codex.mjs"),
  `import fs from "node:fs";
export function readOutputSchema() { return {}; }
export async function runAppServerTurn(cwd, options) {
  fs.appendFileSync(
    process.env.TEST_PROMPT_LOG,
    options.prompt + "MODEL=" + options.model + " EFFORT=" + options.effort + "\\n=====\\n"
  );
  if (process.env.TEST_FAIL !== undefined) {
    return { finalMessage: process.env.TEST_FAIL, status: 1, error: { message: "FAIL_MARKER" } };
  }
  return { finalMessage: process.env.TEST_EMPTY ? "" : '{"verdict":"approve"}', status: 0 };
}
export function parseStructuredOutput(raw) {
  return raw ? { parsed: JSON.parse(raw), rawOutput: raw } : { parsed: null, rawOutput: "" };
}\n`
);
write(
  path.join(plugin, "scripts", "lib", "prompts.mjs"),
  `import fs from "node:fs";
import path from "node:path";
export function loadPromptTemplate(root, name) {
  return fs.readFileSync(path.join(root, "prompts", name + ".md"), "utf8");
}
export function interpolateTemplate(template, vars) {
  return template.replace(/\\{\\{([A-Z_]+)\\}\\}/g, (_, k) => (k in vars ? vars[k] : ""));
}\n`
);
write(
  path.join(plugin, "scripts", "lib", "render.mjs"),
  `export function renderReviewResult(parsed, meta) { return "RENDERED " + meta.targetLabel + "\\n"; }\n`
);
write(path.join(plugin, "prompts", "adversarial-review.md"), "FOCUS={{USER_FOCUS}}\nGUIDANCE={{REVIEW_COLLECTION_GUIDANCE}}\nINPUT={{REVIEW_INPUT}}\n");
write(path.join(plugin, "schemas", "review-output.schema.json"), "{}\n");
write(
  path.join(home, ".claude", "plugins", "installed_plugins.json"),
  JSON.stringify({ plugins: { "codex@openai-codex": [{ installPath: plugin }] } })
);

write(path.join(repo, "target.md"), "TARGET_MARKER\n");
write(path.join(repo, "other.md"), "OTHER_MARKER\n");
spawnSync("git", ["init", "-q"], { cwd: repo });

// feature (checked out) and main fork after base.txt, then commit committed.txt and upstream.txt.
function branchRepo(name, extra = () => {}) {
  const dir = path.join(tmp, name);
  const g = (...args) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir });
  write(path.join(dir, "base.txt"), "BASE\n");
  g("init", "-q", "-b", "main");
  g("add", ".");
  g("commit", "-qm", "base");
  g("checkout", "-qb", "feature");
  write(path.join(dir, "committed.txt"), "COMMITTED_MARKER\n");
  g("add", ".");
  g("commit", "-qm", "feature");
  g("checkout", "-q", "main");
  write(path.join(dir, "upstream.txt"), "UPSTREAM_MARKER\n");
  g("add", ".");
  g("commit", "-qm", "upstream");
  g("checkout", "-q", "feature");
  extra(dir, g);
  return dir;
}

// Edits base.txt, stages a new staged.txt, and leaves untracked.txt untracked.
function dirtyTree(dir, g) {
  write(path.join(dir, "base.txt"), "BASE\nUNSTAGED\n");
  write(path.join(dir, "staged.txt"), "STAGED\n");
  g("add", "staged.txt");
  write(path.join(dir, "untracked.txt"), "UNTRACKED\n");
}

const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8" }).stdout.trim();
const headOf = (cwd) => git(cwd, "rev-parse", "HEAD");

// The prompt carries no diff, so it has to name the merge base and the command that reads it.
const namesDiffCommand = (prompt, sha) =>
  /^[0-9a-f]{40}$/.test(sha) &&
  prompt.includes(`## Merge Base\n\n${sha}\n`) &&
  prompt.includes(`\`git diff ${sha}\``);

// fail: the finalMessage a failed (status 1) turn returns.
function run(args, { empty = false, fail, noPlugin = false, cwd = repo } = {}) {
  fs.writeFileSync(promptLog, "");
  const env = {
    ...process.env,
    HOME: noPlugin ? path.join(tmp, "nohome") : home,
    USERPROFILE: noPlugin ? path.join(tmp, "nohome") : home,
    TEST_REPO: cwd,
    TEST_PROMPT_LOG: promptLog
  };
  if (empty) env.TEST_EMPTY = "1";
  else delete env.TEST_EMPTY;
  if (fail !== undefined) env.TEST_FAIL = fail;
  else delete env.TEST_FAIL;

  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", env });
  return { ...result, prompts: fs.readFileSync(promptLog, "utf8") };
}

const cases = [
  [
    "--files scopes the input to that file",
    () => {
      const r = run(["--files", "target.md", "focus"]);
      return (
        r.status === 0 &&
        r.stdout.includes("RENDERED files: target.md") &&
        r.stderr === "" &&
        r.prompts.includes("TARGET_MARKER") &&
        !r.prompts.includes("OTHER_MARKER")
      );
    }
  ],
  [
    "no --base lists staged, unstaged and untracked files against HEAD",
    () => {
      const cwd = branchRepo("nobase", dirtyTree);
      const r = run(["focus"], { cwd });
      return (
        r.status === 0 &&
        ["base.txt", "staged.txt", "untracked.txt"].every((f) => r.prompts.includes(f)) &&
        !r.prompts.includes("committed.txt") &&
        namesDiffCommand(r.prompts, headOf(cwd))
      );
    }
  ],
  [
    "--files resolving to nothing stops instead of widening",
    () => {
      const r = run(["--files", " , ", "focus"]);
      return r.status === 2 && r.prompts === "";
    }
  ],
  ["--files naming a missing path exits 2", () => run(["--files", "nope.md"]).status === 2],
  [
    "--model and --effort reach the turn and stay out of the focus text",
    () => {
      const r = run([
        "--files", "target.md", "--model", "some-model", "focus", "--effort", "high", "words"
      ]);
      return (
        r.status === 0 &&
        r.prompts.includes("FOCUS=focus words\n") &&
        r.prompts.includes("MODEL=some-model EFFORT=high\n")
      );
    }
  ],
  [
    "no --model or --effort leaves both to codex",
    () =>
      run(["--files", "target.md", "focus"]).prompts.includes("MODEL=undefined EFFORT=undefined\n")
  ],
  [
    "a failed turn exits 1 with codex's message after one turn, with or without a report",
    () =>
      ["", '{"verdict":"approve"}'].every((finalMessage) => {
        const r = run(["--files", "target.md"], { fail: finalMessage });
        return (
          r.status === 1 &&
          r.stderr.includes("FAIL_MARKER") &&
          r.prompts.split("=====").length - 1 === 1
        );
      })
  ],
  [
    "an empty report exits 1 with an error after one turn",
    () => {
      const r = run(["--files", "target.md"], { empty: true });
      return (
        r.status === 1 &&
        r.stderr.trim() !== "" &&
        r.prompts.split("=====").length - 1 === 1
      );
    }
  ],
  [
    "--base lists commits, staged, unstaged and untracked files since the merge base, not upstream",
    () => {
      const cwd = branchRepo("dirty", dirtyTree);
      const r = run(["--base", "main"], { cwd });
      const mergeBase = git(cwd, "merge-base", "HEAD", "main");
      return (
        r.status === 0 &&
        ["committed.txt", "base.txt", "staged.txt", "untracked.txt"].every((f) =>
          r.prompts.includes(f)
        ) &&
        !r.prompts.includes("upstream.txt") &&
        namesDiffCommand(r.prompts, mergeBase)
      );
    }
  ],
  [
    "--base on a branch with no commits of its own reviews the dirty tree",
    () => {
      const cwd = branchRepo("nocommits", (dir, g) => {
        g("checkout", "-q", "-b", "fresh", "main");
        write(path.join(dir, "base.txt"), "BASE\nUNSTAGED_MARKER\n");
      });
      return run(["--base", "main"], { cwd }).prompts.includes("base.txt");
    }
  ],
  [
    "--base with an unknown ref exits 2 before any turn",
    () => {
      const r = run(["--base", "nope"], { cwd: branchRepo("badref") });
      return r.status === 2 && r.stderr.includes("nope") && r.prompts === "";
    }
  ],
  [
    "a missing plugin exits 2",
    () => {
      const r = run(["--files", "target.md"], { noPlugin: true });
      return r.status === 2 && r.stderr.includes("CODEX_NOT_INSTALLED");
    }
  ]
];

let failed = 0;
for (const [name, check] of cases) {
  const ok = check();
  failed += !ok;
  console.log(`${ok ? "pass" : "FAIL"}  ${name}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log();
if (failed) {
  console.error(`FAIL: ${failed} case(s)`);
  process.exit(1);
}
console.log("PASS");
