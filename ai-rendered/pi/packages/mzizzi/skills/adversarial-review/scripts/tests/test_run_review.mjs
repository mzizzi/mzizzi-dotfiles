#!/usr/bin/env node
// Run against either generated bundle: node scripts/tests/test_run_review.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkOutcome, outputSchema, renderOutcome } from "../lib/review.mjs";

const native = true;
const script = fileURLToPath(new URL("../run_review.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adversarial-review-test-"));
const home = path.join(tmp, "home");
const plugin = path.join(home, "plug");
const log = path.join(tmp, "turns.jsonl");
const report = { verdict: "approve", summary: "No material risks found.", findings: [], next_steps: [] };
const complete = { status: "complete", report, reason: null };
const write = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const git = (cwd, ...args) => {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
function repository(name) {
  const cwd = path.join(tmp, name);
  write(path.join(cwd, "target.md"), "TARGET_MARKER\n");
  write(path.join(cwd, "other.md"), "OTHER_MARKER\n");
  write(path.join(cwd, "empty.md"), "");
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base");
  return cwd;
}
function dirty(cwd) {
  write(path.join(cwd, "target.md"), "TARGET_MARKER\nSTAGED_MARKER\n");
  git(cwd, "add", "target.md");
  write(path.join(cwd, "target.md"), "TARGET_MARKER\nSTAGED_MARKER\nUNSTAGED_MARKER\n");
  write(path.join(cwd, "untracked.md"), "UNTRACKED_MARKER\n");
}
write(path.join(home, ".claude/plugins/installed_plugins.json"), JSON.stringify({ plugins: { "codex@openai-codex": [{ installPath: plugin }] } }));
write(path.join(plugin, "scripts/lib/codex.mjs"), `import fs from "node:fs";
export async function runAppServerTurn(cwd, options) {
  fs.appendFileSync(process.env.TEST_LOG, JSON.stringify({ cwd, ...options }) + "\\n");
  if (process.env.TEST_FAILED) return { status: 1, finalMessage: process.env.TEST_OUTCOME, error: { message: "FAIL_MARKER" } };
  return { status: 0, finalMessage: process.env.TEST_EMPTY ? "" : process.env.TEST_OUTCOME };
}
export function parseStructuredOutput(raw) { try { return { parsed: JSON.parse(raw) }; } catch { return { parsed: null }; } }
`);
const repo = repository("repo");
let sequence = 0;
function run(args, { cwd = repo, outcome = complete, missingPlugin = false, failed = false, empty = false, raw, configDir } = {}) {
  fs.writeFileSync(log, "");
  const env = { ...process.env, HOME: missingPlugin ? path.join(tmp, "absent") : home, USERPROFILE: missingPlugin ? path.join(tmp, "absent") : home,
    TEST_LOG: log, TEST_OUTCOME: raw ?? JSON.stringify(outcome), TEST_FAILED: failed ? "1" : "", TEST_EMPTY: empty ? "1" : "" };
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  else delete env.CLAUDE_CONFIG_DIR;
  const execute = (argv) => spawnSync(process.execPath, [script, ...argv], { cwd, env, encoding: "utf8" });
  const preparation = execute(native ? ["prepare", ...args] : args);
  if (!native) {
    const turns = fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
    return { ...preparation, turns, prepared: turns[0], preparation };
  }
  if (preparation.status !== 0) return { ...preparation, turns: [], preparation };
  const prepared = JSON.parse(preparation.stdout);
  const directory = path.join(tmp, `native-${sequence++}`);
  write(path.join(directory, "prepared.json"), preparation.stdout);
  write(path.join(directory, "outcome.json"), failed || empty ? JSON.stringify({ status: "unavailable", report: null, reason: "FAIL_MARKER" }) : raw ?? JSON.stringify(outcome));
  return { ...execute(["render", path.join(directory, "prepared.json"), path.join(directory, "outcome.json")]), prepared, turns: [], preparation };
}
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test("explicit committed document includes contents, focus and no unrelated file", () => {
  const r = run(["--files", "target.md", "focus", "words"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Verdict: approve/);
  assert.match(r.stdout, /No material findings\./);
  assert.match(r.prepared.prompt, /TARGET_MARKER/);
  assert.match(r.prepared.prompt, /User focus: focus words/);
  assert.doesNotMatch(r.prepared.prompt, /OTHER_MARKER/);
});
test("repeated and comma-separated files include empty files", () => {
  const r = run(["--files", "target.md,empty.md", "--files", "other.md"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.prepared.prompt, /### empty.md/);
  assert.match(r.prepared.prompt, /OTHER_MARKER/);
});
test("explicit files collect staged and unstaged diffs without unrelated contents", () => {
  const cwd = repository("files-dirty"); dirty(cwd);
  const r = run(["--files", "target.md"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.prepared.prompt, /STAGED_MARKER/);
  assert.match(r.prepared.prompt, /UNSTAGED_MARKER/);
  assert.doesNotMatch(r.prepared.prompt, /UNTRACKED_MARKER|OTHER_MARKER/);
});
test("empty scope, missing file, directory and missing flag values stop preparation", () => {
  for (const args of [["--files", " , "], ["--files", "missing"], ["--files", "."], ["--model"], ["--files", "--base", "HEAD"]]) {
    const r = run(args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.equal(r.stdout, "");
    assert.equal(r.turns.length, 0);
  }
});
test("default base lists dirty/untracked files and instructs a working-tree diff", () => {
  const cwd = repository("default-base"); dirty(cwd);
  const r = run([], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.prepared.prompt, new RegExp("`git diff " + git(cwd, "rev-parse", "HEAD") + "`"));
  assert.match(r.prepared.prompt, /untracked.md/);
  assert.match(r.prepared.prompt, /target.md/);
});
test("diverged base includes feature commits and dirty tree, not upstream-only changes", () => {
  const cwd = repository("diverged");
  const base = git(cwd, "rev-parse", "HEAD");
  git(cwd, "checkout", "-qb", "feature");
  write(path.join(cwd, "committed.md"), "FEATURE\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "feature");
  git(cwd, "checkout", "-q", "main");
  write(path.join(cwd, "upstream.md"), "UPSTREAM\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "upstream");
  git(cwd, "checkout", "-q", "feature"); dirty(cwd);
  const r = run(["--base", "main"], { cwd });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.prepared.prompt, new RegExp("`git diff " + base + "`"));
  for (const file of ["committed.md", "target.md", "untracked.md"]) assert.ok(r.prepared.prompt.includes(file));
  assert.doesNotMatch(r.prepared.prompt, /upstream.md/);
});
test("invalid base and non-repository fail without a request", () => {
  for (const [cwd, args] of [[repo, ["--base", "absent"]], [tmp, ["--files", "target.md"]]]) {
    const r = run(args, { cwd }); assert.equal(r.status, 2); assert.equal(r.stdout, ""); assert.equal(r.turns.length, 0);
  }
});
test("model and effort forwarding do not leak into focus", () => {
  const model = native ? "gpt-6-astra" : "some-model";
  const r = run(["--files", "target.md", "--model", model, "focus", "--effort", "medium", "words"]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.prepared.model, native ? "chatgpt/gpt-6-astra" : model);
  assert.equal(r.prepared.effort, "medium");
  assert.match(r.prepared.prompt, /User focus: focus words/);
});
test("defaults and target-specific delivery preserve the same outcome schema", () => {
  const r = run(["--files", "target.md"]);
  assert.deepEqual(r.prepared.outputSchema, outputSchema);
  assert.equal(r.prepared.model, native ? "chatgpt/gpt-6-astra" : undefined);
  assert.equal(r.prepared.effort, native ? "high" : undefined);
  assert.match(r.prepared.prompt, /Review without changing target files/);
  assert.match(r.prepared.prompt, /status `unavailable`/);
  assert.equal(r.prepared.prompt.includes("Your final action must call structured_output"), native);
});
test("unavailable, failed and missing output never produce a report", () => {
  for (const options of [{ outcome: { status: "unavailable", report: null, reason: "NO_COVERAGE" } }, { failed: true }, { empty: true }]) {
    const r = run(["--files", "target.md"], options);
    assert.equal(r.status, 1); assert.equal(r.stdout, ""); assert.match(r.stderr, /Review unavailable:/);
    if (!native) assert.equal(r.turns.length, 1);
  }
});
test("invalid JSON, missing report and inconsistent envelope never approve", () => {
  for (const options of [{ raw: "not json" }, { outcome: { status: "complete", report: {}, reason: null } },
    { outcome: { status: "complete", report, reason: "not null" } }, { outcome: { status: "unavailable", report, reason: "oops" } },
    { outcome: report }, { outcome: { status: "complete", report: { ...report, verdict: "bogus" }, reason: null } }]) {
    const r = run(["--files", "target.md"], options); assert.equal(r.status, 1); assert.equal(r.stdout, "");
  }
});
test("formatter preserves severity order, fallbacks, recommendations and optional next steps", () => {
  const outcome = { status: "complete", reason: null, report: { verdict: "needs-attention", summary: " Risk found. ", findings: [
    { severity: "low", title: "Minor", file: "a", body: " low ", line_start: 8, line_end: 3, recommendation: " Fix it. " },
    { severity: "critical", title: "Major", file: "b", body: "high", line_start: 2, line_end: 4 }, null
  ], next_steps: [" Check it. ", "", 42] } };
  const expected = "# REVIEWER Adversarial Review\n\nTarget: files: a\nVerdict: needs-attention\n\nRisk found.\n\nFindings:\n- [critical] Major (b:2-4)\n  high\n- [low] Minor (a:8)\n  low\n  Recommendation: Fix it.\n- [low] Finding 3 (unknown)\n  No details provided.\n\nNext steps:\n- Check it.\n";
  assert.equal(renderOutcome(outcome, "files: a", "REVIEWER"), expected);
  assert.throws(() => checkOutcome({ ...complete, report: null }), /Incomplete/);
});
if (native) {
  test("native prepare needs no Codex plugin and rejects unsupported configuration", () => {
    assert.equal(run(["--files", "target.md"], { missingPlugin: true }).status, 0);
    for (const args of [["--model", "other"], ["--effort", "not-an-effort"]]) assert.equal(run(["--files", "target.md", ...args]).status, 2);
    assert.equal(run(["--files", "target.md", "--model", "chatgpt/gpt-6-astra"]).status, 0);
  });
  test("native unavailable command produces the common envelope", () => {
    const r = spawnSync(process.execPath, [script, "unavailable", "Cancelled by operator"], { encoding: "utf8" });
    assert.equal(r.status, 0); assert.deepEqual(JSON.parse(r.stdout), { status: "unavailable", report: null, reason: "Cancelled by operator" });
  });
} else {
  test("CLAUDE_CONFIG_DIR takes precedence over the default plugin registry", () => {
    const configDir = path.join(tmp, "custom Claude profile");
    write(path.join(configDir, "plugins/installed_plugins.json"), JSON.stringify({ plugins: { "codex@openai-codex": [{ installPath: plugin }] } }));
    const r = run(["--files", "target.md"], { configDir, missingPlugin: true });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Verdict: approve/);
    assert.equal(r.turns.length, 1);
  });
  test("an absent explicit Claude profile does not fall back to the default registry", () => {
    const r = run(["--files", "target.md"], { configDir: path.join(tmp, "absent-profile") });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /CODEX_NOT_INSTALLED/);
    assert.equal(r.turns.length, 0);
  });
  test("missing Codex plugin returns setup failure", () => {
    const r = run(["--files", "target.md"], { missingPlugin: true });
    assert.equal(r.status, 2); assert.match(r.stderr, /CODEX_NOT_INSTALLED/); assert.equal(r.stdout, "");
  });
}
let failed = 0;
try {
  for (const [name, fn] of cases) {
    try { fn(); console.log(`pass  ${name}`); } catch (error) { failed++; console.error(`FAIL  ${name}\n${error.stack}`); }
  }
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`${cases.length - failed}/${cases.length} passed (${native ? "Pi" : "Claude"}).`);
process.exitCode = failed ? 1 : 0;
