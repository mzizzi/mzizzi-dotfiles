import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import { piPackageRoot } from "./pi-host.mjs";

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

function harness({
  cwd = "/workspace/project",
  branch = null,
  statuses = new Map(),
} = {}) {
  const subscribers = new Set();
  let redraws = 0;
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
  start({ type: "session_start" }, {
    mode: "tui",
    cwd,
    ui: {
      setFooter(factory) {
        footer = factory(tui, undefined, footerData);
      },
    },
  });
  return {
    footer,
    setBranch(next) {
      branch = next;
      for (const callback of subscribers) callback();
    },
    get redraws() {
      return redraws;
    },
  };
}

footerTest("reads the current quota on each render without changing its text", () => {
  const initial = "\x1b[32mCodex 12% used · resets in 4h\x1b[0m";
  const updated = " Codex  15% used · resets in 3h ";
  const statuses = new Map([[quotaKey, initial]]);
  const { footer } = harness({ statuses });
  assert.deepEqual(footer.render(80), [`/workspace/project · ${initial}`]);
  statuses.set(quotaKey, updated);
  assert.deepEqual(footer.render(80), [`/workspace/project · ${updated}`]);
  statuses.delete(quotaKey);
  assert.deepEqual(footer.render(80), ["/workspace/project"]);
});

footerTest("redraws on branch changes and unsubscribes when disposed", () => {
  const h = harness({ branch: "main" });
  assert.deepEqual(h.footer.render(80), ["/workspace/project (main)"]);
  h.setBranch("feature");
  assert.equal(h.redraws, 1);
  h.footer.invalidate();
  assert.deepEqual(h.footer.render(80), ["/workspace/project (feature)"]);
  h.footer.dispose();
  h.setBranch("ignored");
  assert.equal(h.redraws, 1);
});

footerTest("does not register a footer outside TUI mode", () => {
  for (const mode of ["rpc", "print"]) {
    start({ type: "session_start" }, {
      mode,
      ui: { setFooter: () => assert.fail(`Unexpected footer in ${mode} mode`) },
    });
  }
});

footerTest("sorts and flattens nonempty secondary statuses", () => {
  const statuses = new Map([
    ["zeta", "\r final\t status "],
    ["empty", ""],
    [quotaKey, "Codex 12% used"],
    ["blank", "\n\t "],
    ["alpha", "first\nstatus"],
  ]);
  const { footer } = harness({ statuses });
  assert.deepEqual(footer.render(80), [
    "/workspace/project · Codex 12% used",
    "first status final status",
  ]);
  statuses.delete("zeta");
  statuses.delete("alpha");
  assert.deepEqual(footer.render(80), ["/workspace/project · Codex 12% used"]);
});

footerTest("fits both rows into the terminal, prioritizing quota over location", () => {
  const quota = "\x1b[36m界界 Codex 12% used\x1b[0m";
  const statuses = new Map([
    [quotaKey, quota],
    ["other", `\x1b[33m${"界".repeat(30)}\x1b[0m`],
  ]);
  const { footer } = harness({ cwd: "/界界界/project", statuses });
  const quotaWidth = visibleWidth(quota);
  const narrowLocation = footer.render(quotaWidth + 8)[0];
  assert.ok(narrowLocation.endsWith(quota));
  assert.equal(
    stripVTControlCharacters(narrowLocation),
    "/界… · 界界 Codex 12% used",
  );
  assert.equal(footer.render(quotaWidth + 3)[0], quota);
  const clippedQuota = footer.render(3)[0];
  assert.match(clippedQuota, /^\x1b\[36m界\x1b\[0m$/);
  for (let width = 1; width <= 40; width++) {
    const rows = footer.render(width);
    assert.equal(rows.length, 2);
    for (const row of rows) assert.ok(visibleWidth(row) <= width, `width ${width}`);
  }
  assert.deepEqual(footer.render(0), []);
  statuses.delete(quotaKey);
  assert.equal(stripVTControlCharacters(footer.render(4)[0]), "/界…");
});

footerTest("replaces terminal controls in the location before rendering", () => {
  const { footer } = harness({
    cwd: "/repo\n\x1b[31mname\x9b",
    branch: "main\t\x7f",
  });
  assert.deepEqual(footer.render(80), ["/repo??[31mname? (main??)"]);
});
