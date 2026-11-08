import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { renderReviewResult, validateReviewResultShape } from "./review-format.mjs";

const references = fileURLToPath(new URL("../../references/", import.meta.url));
export const reportSchema = JSON.parse(fs.readFileSync(path.join(references, "review-output.schema.json"), "utf8"));
const { $schema, ...reportDefinition } = reportSchema;

// Nullable, required fields keep the same schema usable by both structured-output transports.
// checkOutcome enforces the relationship between the discriminant and the nullable fields.
export const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "report", "reason"],
  properties: {
    status: { type: "string", enum: ["complete", "unavailable"] },
    report: { anyOf: [reportDefinition, { type: "null" }] },
    reason: { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] }
  }
};

export function unavailable(reason) {
  return { status: "unavailable", report: null, reason: String(reason || "The review did not complete.") };
}

export function checkOutcome(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Missing review outcome object.");
  if (Object.keys(value).some((key) => !["status", "report", "reason"].includes(key))) throw new Error("Unexpected review outcome field.");
  if (value.status === "unavailable") {
    if (value.report !== null || typeof value.reason !== "string" || !value.reason.trim()) throw new Error("Unavailable review needs a reason and a null report.");
  } else if (value.status === "complete") {
    if (value.reason !== null) throw new Error("Complete review needs a null reason.");
    const error = validateReviewResultShape(value.report);
    if (error) throw new Error(`Incomplete review report: ${error}`);
    if (!["approve", "needs-attention"].includes(value.report.verdict.trim())) throw new Error("Invalid review verdict.");
  } else {
    throw new Error("Review outcome must be complete or unavailable.");
  }
  return value;
}

export function renderOutcome(value, targetLabel, reviewer) {
  const outcome = checkOutcome(value);
  if (outcome.status === "unavailable") throw new Error(outcome.reason);
  return renderReviewResult({ parsed: outcome.report }, { reviewLabel: "Adversarial Review", targetLabel })
    .replace(/^# Codex /, `# ${reviewer} `);
}

export function parseArguments(argv) {
  const options = { files: [] };
  const focus = [];
  const flags = ["--files", "--base", "--model", "--effort"];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") {
      focus.push(...argv.slice(i + 1));
      break;
    }
    if (!flags.includes(token)) {
      focus.push(token);
      continue;
    }
    const value = argv[++i];
    if (value === undefined || flags.includes(value)) throw new Error(`Missing value for ${token}.`);
    if (token === "--files") {
      options.filesRequested = true;
      options.files.push(...value.split(",").map((file) => file.trim()).filter(Boolean));
    } else {
      options[token.slice(2)] = value;
    }
  }
  if (options.filesRequested && !options.files.length) throw new Error("--files was given but resolved to no paths.");
  return { ...options, focus: focus.join(" ").trim() };
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || `git ${args[0]} failed.`);
  return result.stdout;
}

const section = (title, body) => `## ${title}\n\n${body.trim() || "(none)"}\n`;

export function collectContext(options, cwd = process.cwd()) {
  const repoRoot = runGit(cwd, ["rev-parse", "--show-toplevel"]).trim();
  if (options.files.length) {
    const missing = options.files.filter((file) => !fs.existsSync(path.resolve(repoRoot, file)));
    if (missing.length) throw new Error(`No such file(s) under ${repoRoot}: ${missing.join(", ")}`);
    const contents = options.files.map((file) => {
      const body = fs.readFileSync(path.resolve(repoRoot, file), "utf8").trimEnd();
      return `### ${file}\n\`\`\`\n${body}\n\`\`\``;
    }).join("\n\n");
    return {
      repoRoot,
      targetLabel: `files: ${options.files.join(", ")}`,
      collectionGuidance: "The files below are the entire review target. You may read related files read-only for context, but every finding must land on one of these files.",
      content: [
        section("Target Files", options.files.join("\n")),
        section("Staged Diff", runGit(repoRoot, ["diff", "--cached", "--no-ext-diff", "--", ...options.files])),
        section("Unstaged Diff", runGit(repoRoot, ["diff", "--no-ext-diff", "--", ...options.files])),
        section("File Contents", contents)
      ].join("\n")
    };
  }
  const ref = options.base ?? "HEAD";
  let base;
  try {
    base = runGit(repoRoot, ["merge-base", "HEAD", ref]).trim();
  } catch (error) {
    throw new Error(`No merge base between HEAD and ${ref}: ${error.message}`);
  }
  return {
    repoRoot,
    targetLabel: `changes since the merge base with ${ref}, committed or not`,
    collectionGuidance: `The review target is the working tree against merge base ${base}: commits since it, uncommitted edits, and the untracked files listed below, which are new. Nothing is inlined. Before finalizing findings, run \`git diff ${base}\` (working tree vs that commit, not \`${base}..HEAD\`) and read each untracked file. Read-only git commands and file reads are allowed.`,
    content: [
      section("Merge Base", base),
      section("Changed Files", runGit(repoRoot, ["diff", "--stat", base])),
      section("Untracked Files", runGit(repoRoot, ["ls-files", "--others", "--exclude-standard"]))
    ].join("\n")
  };
}

export function prepareReview(argv, { native = false, cwd = process.cwd() } = {}) {
  const options = parseArguments(argv);
  let model = options.model;
  let effort = options.effort;
  if (native) {
    model ??= "gpt-6-astra";
    if (!["gpt-6-astra", "chatgpt/gpt-6-astra"].includes(model)) throw new Error(`Unsupported native review model: ${model}`);
    model = "chatgpt/gpt-6-astra";
    effort ??= "high";
    if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(effort)) throw new Error(`Unsupported native review effort: ${effort}`);
  }
  const context = collectContext(options, cwd);
  const vars = {
    TARGET_LABEL: context.targetLabel,
    USER_FOCUS: options.focus || "No extra focus provided.",
    REVIEW_COLLECTION_GUIDANCE: context.collectionGuidance,
    REVIEW_INPUT: context.content
  };
  let prompt = fs.readFileSync(path.join(references, "adversarial-review.md"), "utf8")
    .replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
      if (!(key in vars)) throw new Error(`Unknown review prompt variable: ${key}`);
      return vars[key];
    });
  if (native) prompt = prompt.replace("You are Codex performing", "You are Astra performing");
  prompt += "\n<completion_contract>\nReview without changing target files.\nReturn the shared outcome envelope. A complete review has status `complete`, the review in `report`, and reason null. If you cannot complete the review or cover its required scope, use status `unavailable`, report null, and a specific nonempty reason. Do not report approval for incomplete coverage.\n";
  prompt += native
    ? "Your final action must call structured_output with the envelope as its value. Do not finish with prose or a JSON code block.\n"
    : "Return only the outcome envelope as JSON matching the provided schema.\n";
  prompt += "</completion_contract>\n";
  return { repoRoot: context.repoRoot, targetLabel: context.targetLabel, model, effort, prompt, outputSchema };
}

export function fail(error, code = 1) {
  const outcome = unavailable(error instanceof Error ? error.message : error);
  process.stderr.write(`Review unavailable: ${outcome.reason}\n`);
  process.exitCode = code;
}
