import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { piPackageRoot } from "./pi-host.mjs";
import { fixture, git } from "./worktree-fixture.mjs";

let cli;
try {
  cli = execFileSync("which", ["pi"], { encoding: "utf8" }).trim();
} catch {}

let start;
let visibleWidth;
if (cli) {
  const root = piPackageRoot(realpathSync(cli));
  const { discoverAndLoadExtensions } = await import(
    pathToFileURL(join(root, "dist/index.js"))
  );
  const require = createRequire(join(root, "package.json"));
  ({ visibleWidth } = await import(
    pathToFileURL(require.resolve("@earendil-works/pi-tui"))
  ));
  const extensionDir = fileURLToPath(
    new URL("../extensions/codex-footer", import.meta.url),
  );
  const sandbox = mkdtempSync(join(tmpdir(), "codex-footer-"));
  try {
    const { extensions, errors } = await discoverAndLoadExtensions(
      [extensionDir],
      sandbox,
      sandbox,
    );
    assert.deepEqual(errors, []);
    assert.equal(extensions.length, 1);
    const handlers = extensions[0].handlers.get("session_start");
    assert.equal(handlers?.length, 1);
    [start] = handlers;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

const footerTest = (name, fn) =>
  test(name, { skip: !start && "Install Pi to run footer contract tests" }, fn);
const quotaKey = "codex-usage";
const unknownContext = "? · ctx ?/?";

async function harness({
  cwd = "/workspace/project",
  branch = null,
  statuses = new Map(),
  model,
  usage,
} = {}) {
  const subscribers = new Set();
  let redraws = 0;
  let usageReads = 0;
  let leafId = null;
  let footer;
  const tui = { requestRender: () => redraws++ };
  const footerData = {
    getGitBranch: () => branch,
    getExtensionStatuses: () => statuses,
    onBranchChange(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
  };
  await start({ type: "session_start" }, {
    mode: "tui",
    cwd,
    get model() {
      return model;
    },
    sessionManager: { getLeafId: () => leafId },
    getContextUsage() {
      usageReads++;
      return usage;
    },
    ui: {
      setFooter(factory) {
        footer = factory(tui, undefined, footerData);
      },
    },
  });
  return {
    footer,
    setModel(next, nextUsage) {
      model = next;
      usage = nextUsage;
    },
    setLeaf(next, nextUsage) {
      leafId = next;
      usage = nextUsage;
    },
    get usageReads() {
      return usageReads;
    },
    setBranch(next) {
      branch = next;
      for (const callback of subscribers) callback();
    },
    get redraws() {
      return redraws;
    },
  };
}

footerTest("reads the current quota on each render without changing its text", async () => {
  const initial = "\x1b[32mCodex 12% used · resets in 4h\x1b[0m";
  const updated = " Codex  15% used · resets in 3h ";
  const statuses = new Map([[quotaKey, initial]]);
  const { footer } = await harness({ statuses });
  assert.deepEqual(footer.render(80), [`project · ${initial}`, unknownContext]);
  statuses.set(quotaKey, updated);
  assert.deepEqual(footer.render(80), [`project · ${updated}`, unknownContext]);
  statuses.delete(quotaKey);
  assert.deepEqual(footer.render(80), ["project", unknownContext]);
});

footerTest("reuses context usage until the session leaf or model changes", async () => {
  const h = await harness({
    model: { id: "gpt-6.2-sol", contextWindow: 1024000 },
    usage: { tokens: 42000, contextWindow: 512000 },
  });
  assert.equal(h.footer.render(80)[1], "gpt-6.2-sol · ctx 42K/512K");
  assert.equal(h.footer.render(40)[1], "gpt-6.2-sol · ctx 42K/512K");
  assert.equal(h.usageReads, 1);
  h.setLeaf("assistant", { tokens: 43500, contextWindow: 512000 });
  assert.equal(h.footer.render(80)[1], "gpt-6.2-sol · ctx 43.5K/512K");
  assert.equal(h.usageReads, 2);
  h.setModel({ id: "next", contextWindow: 1000000 }, { tokens: 43500, contextWindow: 1000000 });
  assert.equal(h.footer.render(80)[1], "next · ctx 43.5K/1M");
  assert.equal(h.usageReads, 3);
});

footerTest("shows unknown usage and the best available context limit", async () => {
  const h = await harness({ model: { id: "model", contextWindow: 200000 } });
  assert.equal(h.footer.render(80)[1], "model · ctx ?/200K");
  h.setLeaf("compaction", { tokens: null, contextWindow: 128000 });
  assert.equal(h.footer.render(80)[1], "model · ctx ?/128K");
  h.setLeaf("assistant", { tokens: 0, contextWindow: 128000 });
  assert.equal(h.footer.render(80)[1], "model · ctx 0/128K");
});

footerTest("uses the canonical repo name from a nested checkout or linked worktree", async (t) => {
  const { source, target } = fixture(t);
  const main = await harness({ cwd: join(source, "subdir"), branch: "main" });
  assert.equal(main.footer.render(80)[0], "source (main)");
  const linked = await harness({ cwd: join(target, "subdir"), branch: "feature" });
  assert.equal(linked.footer.render(80)[0], "source (feature)");
});

footerTest("falls back to cwd basename outside Git or for ambiguous Git paths", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "codex-footer-repo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const outside = join(dir, "not a repo");
  mkdirSync(outside);
  const plain = await harness({ cwd: outside });
  assert.equal(plain.footer.render(80)[0], "not a repo");
  const repo = join(dir, "repo\nname");
  const nested = join(repo, "subdir");
  mkdirSync(nested, { recursive: true });
  git(repo, "init");
  const ambiguous = await harness({ cwd: nested });
  assert.equal(ambiguous.footer.render(80)[0], "subdir");
});

footerTest("redraws on branch changes and unsubscribes when disposed", async () => {
  const h = await harness({ branch: "main" });
  assert.equal(h.footer.render(80)[0], "project (main)");
  h.setBranch("feature");
  assert.equal(h.redraws, 1);
  h.footer.invalidate();
  assert.equal(h.footer.render(80)[0], "project (feature)");
  h.footer.dispose();
  h.setBranch("ignored");
  assert.equal(h.redraws, 1);
});

footerTest("does not register a footer outside TUI mode", async () => {
  for (const mode of ["rpc", "print"]) {
    await start({ type: "session_start" }, {
      mode,
      ui: { setFooter: () => assert.fail(`Unexpected footer in ${mode} mode`) },
    });
  }
});

footerTest("sorts and flattens nonempty extension statuses on their own row", async () => {
  const statuses = new Map([
    ["zeta", "\r final\t status "],
    ["empty", ""],
    [quotaKey, "Codex 12% used"],
    ["blank", "\n\t "],
    ["alpha", "first\nstatus"],
  ]);
  const { footer } = await harness({ statuses });
  assert.deepEqual(footer.render(80), [
    "project · Codex 12% used",
    unknownContext,
    "first status final status",
  ]);
  statuses.delete("zeta");
  statuses.delete("alpha");
  assert.deepEqual(footer.render(80), ["project · Codex 12% used", unknownContext]);
});

footerTest("fits each row into the terminal, prioritizing quota over location", async () => {
  const quota = "\x1b[36m界界 Codex 12% used\x1b[0m";
  const statuses = new Map([
    [quotaKey, quota],
    ["other", `\x1b[33m${"界".repeat(30)}\x1b[0m`],
  ]);
  const { footer } = await harness({
    cwd: "/workspace/p界界界-project",
    model: { id: "界".repeat(30) },
    statuses,
  });
  const quotaWidth = visibleWidth(quota);
  const narrowLocation = footer.render(quotaWidth + 8)[0];
  assert.ok(narrowLocation.endsWith(quota));
  assert.equal(
    stripVTControlCharacters(narrowLocation),
    "p界… · 界界 Codex 12% used",
  );
  assert.equal(footer.render(quotaWidth + 3)[0], quota);
  const clippedQuota = footer.render(3)[0];
  assert.match(clippedQuota, /^\x1b\[36m界\x1b\[0m$/);
  for (let width = 1; width <= 40; width++) {
    const rows = footer.render(width);
    assert.equal(rows.length, 3);
    for (const row of rows) assert.ok(visibleWidth(row) <= width, `width ${width}`);
  }
  assert.equal(stripVTControlCharacters(footer.render(5)[2]), "界界…");
  assert.deepEqual(footer.render(0), []);
  statuses.delete(quotaKey);
  assert.equal(stripVTControlCharacters(footer.render(4)[0]), "p界…");
});

footerTest("replaces terminal controls in location and model text", async () => {
  const { footer } = await harness({
    cwd: "/repo\n\x1b[31mname\x9b",
    branch: "main\t\x7f",
    model: { id: "gpt\n\x1b[31m\u2028" },
  });
  assert.deepEqual(footer.render(80), [
    "repo??[31mname? (main??)",
    "gpt??[31m? · ctx ?/?",
  ]);
});
