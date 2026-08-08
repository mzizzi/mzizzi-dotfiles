#!/usr/bin/env node
// Run a Codex adversarial review, optionally scoped to specific files.
//
// Usage: node run_review.mjs [--files <path[,path...]>] [--scope <auto|working-tree|branch>]
//                            [--base <ref>] [focus text]
//
// Without --files this reproduces what `codex-companion.mjs adversarial-review` does. With
// --files it swaps in a review input built from those paths only, which the companion has no
// way to express: its collectors run `git diff` with no pathspec, so every review otherwise
// receives the whole working tree or the whole branch.
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

const argv = process.argv.slice(2);
const options = { files: [] };
const focusWords = [];

for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i];
  if (token === "--files" || token === "--scope" || token === "--base") {
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
    branch: git.getCurrentBranch(repoRoot),
    target: { mode: "files", label: `files: ${files.join(", ")}`, explicit: true },
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

const context = options.files.length
  ? collectFileContext(options.files)
  : git.collectReviewContext(
      cwd,
      git.resolveReviewTarget(cwd, { scope: options.scope, base: options.base })
    );

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

let parsed;
for (let attempt = 0; attempt < 2; attempt += 1) {
  const result = await codex.runAppServerTurn(context.repoRoot, {
    prompt,
    sandbox: "read-only",
    outputSchema
  });

  parsed = codex.parseStructuredOutput(result.finalMessage, {
    status: result.status,
    failureMessage: result.error?.message ?? result.stderr
  });

  // A clean run that produced neither structured output nor raw text is the companion losing the
  // report, not a review that found nothing — a caller can't tell those apart, so retry rather
  // than hand back a silence that reads as a clean bill of health.
  if (parsed.parsed || parsed.rawOutput) {
    process.stdout.write(
      render.renderReviewResult(parsed, {
        reviewLabel: "Adversarial Review",
        targetLabel: context.target.label
      })
    );
    process.exit(0);
  }
}

process.stderr.write("CODEX_EMPTY_REPORT: codex returned no report, twice.\n");
process.exit(1);
