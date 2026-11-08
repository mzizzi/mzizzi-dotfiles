import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const git = (cwd, ...args) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-worktree-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const source = join(dir, "source");
  const target = join(dir, "feature tree");
  const review = join(dir, "review");
  mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.name", "Fixture");
  git(source, "config", "user.email", "fixture@example.test");
  writeFileSync(join(source, "same.txt"), "source\n");
  mkdirSync(join(source, "subdir"));
  writeFileSync(join(source, "subdir/kept.txt"), "subdirectory\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "fixture");
  git(source, "worktree", "add", "-b", "feature", target);
  git(source, "worktree", "add", "--detach", review);
  return { dir, source, target, review };
}
