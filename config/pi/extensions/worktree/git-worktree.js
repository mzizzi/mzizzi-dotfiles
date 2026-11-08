import { execFile } from "node:child_process";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function git(cwd, args, signal) {
  try {
    const { stdout } = await execute("git", args, {
      cwd,
      signal,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    return stdout;
  } catch (error) {
    throw new Error(
      `Git inspection failed in ${cwd}: ${error.stderr || error.message}`,
    );
  }
}

const line = (text) => text.replace(/\r?\n$/, "");

export function parseWorktrees(output) {
  const trees = [];
  let tree;
  for (const field of output.split("\0")) {
    if (!field) continue;
    if (field.startsWith("worktree ")) {
      tree = { path: field.slice(9) };
      trees.push(tree);
    } else if (!tree) {
      throw new Error("Invalid Git worktree registration output.");
    } else if (field.startsWith("HEAD ")) tree.head = field.slice(5);
    else if (field.startsWith("branch ")) tree.branch = field.slice(7);
    else if (field === "detached") tree.detached = true;
    else if (field === "bare") tree.bare = true;
    else if (field.startsWith("prunable")) tree.prunable = true;
  }
  return trees;
}

/** Read-only Git inspection. Accept subdirectories only for source/origin inspection. */
export async function inspectCheckout(cwd, { rootOnly = false, signal } = {}) {
  const canonical = await realpath(cwd);
  const root = await realpath(
    line(
      await git(
        canonical,
        ["rev-parse", "--path-format=absolute", "--show-toplevel"],
        signal,
      ),
    ),
  );
  if (rootOnly && canonical !== root)
    throw new Error(
      "EnterWorktree path must name a registered worktree root, not a subdirectory.",
    );
  const commonDir = await realpath(
    line(
      await git(
        canonical,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        signal,
      ),
    ),
  );
  const gitDir = await realpath(
    line(await git(canonical, ["rev-parse", "--absolute-git-dir"], signal)),
  );
  const records = parseWorktrees(
    await git(canonical, ["worktree", "list", "--porcelain", "-z"], signal),
  );
  const matches = [];
  for (const record of records) {
    // Missing unrelated registrations must not prevent entry into a valid checkout.
    let registeredPath;
    try {
      registeredPath = await realpath(record.path);
    } catch {
      continue;
    }
    if (registeredPath === root) matches.push(record);
  }
  if (
    matches.length !== 1 ||
    matches[0].bare ||
    matches[0].prunable ||
    !matches[0].head
  )
    throw new Error(
      "Worktree registration is missing, stale, bare, or ambiguous.",
    );
  const status = await git(
    canonical,
    ["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
    signal,
  );
  const rootStat = await stat(root, { bigint: true });
  const gitStat = await stat(gitDir, { bigint: true });
  return {
    identity: `${rootStat.dev}:${rootStat.ino}/${gitStat.dev}:${gitStat.ino}`,
    root,
    commonDir,
    gitDir,
    branch: matches[0].branch?.replace(/^refs\/heads\//, "") ?? null,
    detached: matches[0].detached === true,
    dirty: status.length > 0,
  };
}

export function sameCheckout(a, b) {
  return (
    !!a?.identity &&
    a.identity === b?.identity &&
    a.root === b.root &&
    a.commonDir === b.commonDir &&
    a.gitDir === b.gitDir
  );
}

export async function checkDestination(
  cwd,
  path,
  { rootOnly = true, signal } = {},
) {
  const source = await inspectCheckout(cwd, { signal });
  const destinationCwd = resolve(cwd, path);
  const target = await inspectCheckout(destinationCwd, { rootOnly, signal });
  if (source.commonDir !== target.commonDir)
    throw new Error("Destination belongs to a different Git repository.");
  return {
    source,
    target,
    destinationCwd: rootOnly ? target.root : destinationCwd,
  };
}
