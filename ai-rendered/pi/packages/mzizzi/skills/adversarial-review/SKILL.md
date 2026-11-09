---
name: adversarial-review
description: Run an adversarial review of a plan, document, or code change. Challenge assumptions and report material findings with evidence, or explain why the review is unavailable.
disable-model-invocation: false
---

# Adversarial Review

Resolve `<skill-dir>` to this skill's absolute directory. Review without changing target files.

- `--files <paths>`: current contents and staged/unstaged diffs of those files. Repeat the flag or use comma-separated paths.
- `--base <ref>`: the working tree against the merge base, including commits, dirty changes, and untracked files. Default: `HEAD`.
- `--model` and `--effort`: reviewer configuration. Other arguments are focus text.

Never widen an empty or failed explicit-file scope.

## Run

Default to `chatgpt/gpt-6-astra` at high thinking; accept `gpt-6-astra` as an alias. Reject unsupported choices without fallback.

1. **Prepare.** Create `<review-dir>` outside the checkout with `mktemp -d`. Run the helper with the caller's arguments:

   ```bash
   node "<skill-dir>/scripts/run_review.mjs" prepare --files plans/example/plan.md "review focus" > "<review-dir>/prepared.json"
   ```

   Stop on failure. Read the complete prepared JSON, including any truncated portion.

2. **Review.** Enable `subagent` if needed. Start the `mzizzi.adversarial-reviewer` agent with the prepared values verbatim; pass `outputSchema` as an object:

   ```js
   subagent({
     agent: "mzizzi.adversarial-reviewer",
     task: "<prepared.prompt>",
     cwd: "<prepared.repoRoot>",
     model: "<prepared.model>:<prepared.effort>",
     async: true,
     output: "<absolute review-dir>/outcome.json",
     options: { context: "fresh", outputSchema: /* prepared.outputSchema */ }
   })
   ```

   Keep the run id and returned output path. Wait for completion without polling or `bg_wait`. Require successful completion and captured `structured_output`; read its saved JSON, not final prose. Do not switch execution paths on failure.

3. **Render.** For a failed, cancelled, or missing result, ignore any partial artifact and create an unavailable outcome:

   ```bash
   node "<skill-dir>/scripts/run_review.mjs" unavailable "<failure reason>" > "<review-dir>/outcome.json"
   ```

   Otherwise use the returned outcome path. Render it:

   ```bash
   node "<skill-dir>/scripts/run_review.mjs" render "<review-dir>/prepared.json" "<outcome path>"
   ```

   After the child stops and the result is read, remove this run's temporary directory. Return the report or unavailable reason.

## Result

Return the helper's Markdown report. A `complete` review can approve or request attention. A failed, cancelled, missing, or incomplete review is unavailable, never approval.

On failure, return stderr as the unavailable reason and stop this skill. Exit 2 means preparation or dependency failure; exit 1 means execution or output failure.
