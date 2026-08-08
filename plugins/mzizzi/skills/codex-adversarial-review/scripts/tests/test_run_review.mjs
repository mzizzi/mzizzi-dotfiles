#!/usr/bin/env node
// Regression checks for run_review.mjs: --files must scope the review input to those paths, an
// unusable --files must stop rather than fall back to the whole tree, and an empty report must
// retry once before failing.
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

// Stubs standing in for the codex plugin's lib modules. runAppServerTurn records the prompt it
// was handed, which is what the scoping assertions read.
write(
  path.join(plugin, "scripts", "lib", "git.mjs"),
  `export function ensureGitRepository() {}
export function getRepoRoot() { return process.env.TEST_REPO; }
export function getCurrentBranch() { return "main"; }
export function resolveReviewTarget() { return { mode: "working-tree", label: "working tree diff" }; }
export function collectReviewContext() {
  return { repoRoot: process.env.TEST_REPO, branch: "main", target: { label: "working tree diff" },
           collectionGuidance: "guidance", content: "WHOLE_TREE_MARKER" };
}\n`
);
write(
  path.join(plugin, "scripts", "lib", "codex.mjs"),
  `import fs from "node:fs";
export function readOutputSchema() { return {}; }
export async function runAppServerTurn(cwd, options) {
  fs.appendFileSync(process.env.TEST_PROMPT_LOG, options.prompt + "\\n=====\\n");
  return { finalMessage: process.env.TEST_EMPTY ? "" : '{"verdict":"approve"}', status: "ok" };
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
write(path.join(plugin, "prompts", "adversarial-review.md"), "INPUT={{REVIEW_INPUT}}\n");
write(path.join(plugin, "schemas", "review-output.schema.json"), "{}\n");
write(
  path.join(home, ".claude", "plugins", "installed_plugins.json"),
  JSON.stringify({ plugins: { "codex@openai-codex": [{ installPath: plugin }] } })
);

write(path.join(repo, "target.md"), "TARGET_MARKER\n");
write(path.join(repo, "other.md"), "OTHER_MARKER\n");
spawnSync("git", ["init", "-q"], { cwd: repo });

function run(args, { empty = false, noPlugin = false } = {}) {
  fs.writeFileSync(promptLog, "");
  const env = {
    ...process.env,
    HOME: noPlugin ? path.join(tmp, "nohome") : home,
    USERPROFILE: noPlugin ? path.join(tmp, "nohome") : home,
    TEST_REPO: repo,
    TEST_PROMPT_LOG: promptLog
  };
  if (empty) env.TEST_EMPTY = "1";
  else delete env.TEST_EMPTY;

  const result = spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8", env });
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
        r.prompts.includes("TARGET_MARKER") &&
        !r.prompts.includes("OTHER_MARKER") &&
        !r.prompts.includes("WHOLE_TREE_MARKER")
      );
    }
  ],
  [
    "no --files falls back to the plugin's own collector",
    () => run(["focus"]).prompts.includes("WHOLE_TREE_MARKER")
  ],
  [
    "--files resolving to nothing stops instead of widening",
    () => {
      const r = run(["--files", " , ", "focus"]);
      return r.status === 2 && !r.prompts.includes("WHOLE_TREE_MARKER");
    }
  ],
  ["--files naming a missing path exits 2", () => run(["--files", "nope.md"]).status === 2],
  [
    "an empty report retries once, then fails",
    () => {
      const r = run(["--files", "target.md"], { empty: true });
      return (
        r.status === 1 &&
        r.stderr.includes("CODEX_EMPTY_REPORT") &&
        r.prompts.split("=====").length - 1 === 2
      );
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
