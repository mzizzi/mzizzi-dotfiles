---
name: adversarial-review
description: Run an adversarial review of a plan, document, or code change. Challenge assumptions and report material findings with evidence, or explain why the review is unavailable.
argument-hint: '[--files <paths> | --base <ref>] [--model <id>] [--effort <level>] [focus]'
allowed-tools: Bash
disable-model-invocation: false
user-invocable: true
---

# Adversarial Review

Resolve `<skill-dir>` to this skill's absolute directory. Review without changing target files.

- `--files <paths>`: current contents and staged/unstaged diffs of those files. Repeat the flag or use comma-separated paths.
- `--base <ref>`: the working tree against the merge base, including commits, dirty changes, and untracked files. Default: `HEAD`.
- `--model` and `--effort`: reviewer configuration. Other arguments are focus text.

Never widen an empty or failed explicit-file scope.

## Run

Run the helper synchronously with the caller's arguments and Bash timeout `600000` milliseconds. Requires `codex@openai-codex`.

```bash
node "<skill-dir>/scripts/run_review.mjs" --model gpt-6-astra --effort high --files plans/example/plan.md "review focus"
```

Without model/effort arguments, use Codex's configured defaults.

## Result

Return the helper's Markdown report. A `complete` review can approve or request attention. A failed, cancelled, missing, or incomplete review is unavailable, never approval.

On failure, return stderr as the unavailable reason and stop this skill. Exit 2 means preparation or dependency failure; exit 1 means execution or output failure.
