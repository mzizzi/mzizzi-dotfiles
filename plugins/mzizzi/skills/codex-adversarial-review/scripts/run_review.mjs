#!/usr/bin/env node
// Run a Codex adversarial review over specific files, or everything since a merge base
// (uncommitted work by default).
//
// Usage: node run_review.mjs [--files <path[,path...]> | --base <ref>] [--model <id>]
//                            [--effort <level>] [focus text]
//
// `/codex:adversarial-review` sets `disable-model-invocation: true`, and a local edit lifting it
// would live in the versioned plugin cache, which each plugin update replaces. So this script
// finds the plugin through installed_plugins.json and calls its libraries directly.
//
// `codex-companion.mjs adversarial-review` can't express either target: its collectors run
// `git diff` with no pathspec, and its branch mode diffs merge-base..HEAD, skipping uncommitted
// work.
//
// --model and --effort go to Codex as given. Without them Codex uses its own configured model
// and reasoning effort.
//
// See ../SKILL.md for the exit codes.

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const installedJson = path.join(
  process.env.USERPROFILE || process.env.HOME,
  ".claude",
  "plugins",
  "installed_plugins.json"
);

// Absent file, malformed JSON and a missing entry all mean the same thing to the caller.
let pluginRoot = null;
try {
  pluginRoot = JSON.parse(fs.readFileSync(installedJson, "utf8")).plugins["codex@openai-codex"][0]
    .installPath;
} catch {
  pluginRoot = null;
}

if (!pluginRoot || !fs.existsSync(path.join(pluginRoot, "scripts", "lib", "codex.mjs"))) {
  process.stderr.write(
    `CODEX_NOT_INSTALLED: the openai-codex plugin isn't installed or is missing its libraries ` +
      `(looked for a codex@openai-codex entry in ${installedJson}).\n`
  );
  process.exit(2);
}

const lib = (name) => import(pathToFileURL(path.join(pluginRoot, "scripts", "lib", name)).href);

// Importing the companion's own modules rather than shelling out to its CLI is what makes file
// scoping possible, and it pins us to its internal layout. A rename here surfaces as an import
// failure on the next plugin update, not as a silently wrong review.
let git, codex, prompts, render;
try {
  [git, codex, prompts, render] = await Promise.all([
    lib("git.mjs"),
    lib("codex.mjs"),
    lib("prompts.mjs"),
    lib("render.mjs")
  ]);
} catch (error) {
  process.stderr.write(
    `CODEX_CONTRACT_CHANGED: the codex plugin at ${pluginRoot} no longer exposes the modules ` +
      `this script imports (${error.message}).\n`
  );
  process.exit(2);
}

const VALUE_FLAGS = ["--files", "--base", "--model", "--effort"];

const argv = process.argv.slice(2);
const options = { files: [] };
const focusWords = [];

for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i];
  if (VALUE_FLAGS.includes(token)) {
    const value = argv[i + 1];
    if (value === undefined) {
      process.stderr.write(`Missing value for ${token}.\n`);
      process.exit(2);
    }
    if (token === "--files") {
      options.filesRequested = true;
      options.files.push(...value.split(",").map((f) => f.trim()).filter(Boolean));
    } else {
      options[token.slice(2)] = value;
    }
    i += 1;
  } else {
    focusWords.push(token);
  }
}

// Falling back to the whole working tree because `--files "$CHANGED"` expanded to nothing is the
// one failure this script exists to prevent, so an empty scope stops rather than widens.
if (options.filesRequested && !options.files.length) {
  process.stderr.write("--files was given but resolved to no paths.\n");
  process.exit(2);
}

const focusText = focusWords.join(" ").trim();
const cwd = process.cwd();
git.ensureGitRepository(cwd);
const repoRoot = git.getRepoRoot(cwd);

const runGit = (args) =>
  spawnSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout ??
  "";

const section = (title, body) => `## ${title}\n\n${body.trim() ? body.trim() : "(none)"}\n`;

// The target files' current contents go in alongside their diff. A plan document that was just
// committed has no diff at all, and a code hunk without its surrounding file is what makes an
// adversarial finding unfalsifiable.
function collectFileContext(files) {
  const missing = files.filter((file) => !fs.existsSync(path.resolve(repoRoot, file)));
  if (missing.length) {
    process.stderr.write(`No such file(s) under ${repoRoot}: ${missing.join(", ")}\n`);
    process.exit(2);
  }

  const contents = files
    .map((file) => {
      const body = fs.readFileSync(path.resolve(repoRoot, file), "utf8").trimEnd();
      return `### ${file}\n\`\`\`\n${body}\n\`\`\``;
    })
    .join("\n\n");

  return {
    repoRoot,
    target: { label: `files: ${files.join(", ")}` },
    collectionGuidance:
      "The files below are the entire review target. You may read related files read-only for " +
      "context, but every finding must land on one of these files.",
    content: [
      section("Target Files", files.join("\n")),
      section("Staged Diff", runGit(["diff", "--cached", "--no-ext-diff", "--", ...files])),
      section("Unstaged Diff", runGit(["diff", "--no-ext-diff", "--", ...files])),
      section("File Contents", contents)
    ].join("\n")
  };
}

// The target is the working tree against the merge base, not HEAD: a fix-mode sweep reviews
// edits an earlier pass hasn't committed. Codex reads the diff and untracked files itself, so the
// prompt stays small whatever the change size.
function collectBaseContext(ref) {
  const mergeBase = spawnSync("git", ["merge-base", "HEAD", ref], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (mergeBase.status !== 0) {
    process.stderr.write(`No merge base between HEAD and ${ref}: ${mergeBase.stderr.trim()}\n`);
    process.exit(2);
  }
  const base = mergeBase.stdout.trim();

  return {
    repoRoot,
    target: { label: `changes since the merge base with ${ref}, committed or not` },
    collectionGuidance:
      `The review target is the working tree against merge base ${base}: commits since it, ` +
      `uncommitted edits, and the untracked files listed below, which are new. Nothing is ` +
      `inlined. Before finalizing findings, run \`git diff ${base}\` (working tree vs that ` +
      `commit, not \`${base}..HEAD\`) and read each untracked file. Read-only git commands and ` +
      `file reads are allowed.`,
    content: [
      section("Merge Base", base),
      section("Changed Files", runGit(["diff", "--stat", base])),
      section("Untracked Files", runGit(["ls-files", "--others", "--exclude-standard"]))
    ].join("\n")
  };
}

const context = options.files.length
  ? collectFileContext(options.files)
  : collectBaseContext(options.base ?? "HEAD");

const template = prompts.loadPromptTemplate(pluginRoot, "adversarial-review");
const prompt = prompts.interpolateTemplate(template, {
  REVIEW_KIND: "Adversarial Review",
  TARGET_LABEL: context.target.label,
  USER_FOCUS: focusText || "No extra focus provided.",
  REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
  REVIEW_INPUT: context.content
});

const outputSchema = codex.readOutputSchema(
  path.join(pluginRoot, "schemas", "review-output.schema.json")
);

const result = await codex.runAppServerTurn(context.repoRoot, {
  prompt,
  sandbox: "read-only",
  outputSchema,
  model: options.model,
  effort: options.effort
});

if (result.status !== 0 || !result.finalMessage) {
  const reason = result.error?.message || result.stderr || "Codex returned no report.";
  process.stderr.write(`${reason}\n`);
  process.exit(1);
}

process.stdout.write(
  render.renderReviewResult(codex.parseStructuredOutput(result.finalMessage), {
    reviewLabel: "Adversarial Review",
    targetLabel: context.target.label
  })
);
process.exit(0);
