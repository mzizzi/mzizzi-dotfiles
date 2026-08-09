# Shared target resolver for the fix-\* skills — Proposal

## Problem

`fix-quality`, `fix-comments`, and `fix-all` each carry their own prose describing how a target token (`local | pr | <pr-number-or-url>`) becomes a diff. `fix-correctness` carries a third variant: no target at all, working tree only. The duplication has already produced real drift, not just token waste:

- **Same token, different meaning.** `pr` with no open PR falls back to the _branch diff_ in fix-quality (SKILL.md step 1) but to _local_ in fix-comments (SKILL.md step 1). A user running both on the same branch reviews two different change sets.
- **A whole step exists to paper over the mismatch.** fix-all's step 2 is entirely "note what the target means for fix-correctness," because fix-correctness can't accept the target the other two take.
- **Committed work is unreviewable by fix-correctness.** It only sees the working tree, and `run_review.mjs --files` sends staged/unstaged diffs only — implement-plan works around this by _requiring_ changes stay uncommitted until all three passes finish (implement-plan SKILL.md: "Leave the changes uncommitted... All three passes ahead read the working-tree diff").

## What each consumer actually consumes

The seed's blocker was "the three consumers want fundamentally different artifacts." True at the artifact level; false one level down. Traced through each skill:

### fix-correctness

- **Today:** working tree only. Checks `git status --short` for emptiness, then hands off to `codex-adversarial-review` with `--scope auto`. Never holds a diff itself.
- **Consumes:** a path list and a base ref. Codex builds its own review input from those — `run_review.mjs --files` collects staged diff + unstaged diff + full file contents per path.
- **Gap:** `collectFileContext` in run_review.mjs (this repo's own script) diffs against index/worktree only. Committed branch work never reaches Codex. The companion's `--base <ref>` passthrough exists but can't be combined with a path filter — it sends the whole branch diff.

### fix-quality

- **Today:** `local | pr | <pr#>`. Never holds the diff either — step 1: "Keep the exact command that produced the diff. Sub-agents re-run it themselves."
- **Consumes:** a **diff command string** (pasted verbatim into every agent prompt), its `--stat` output (sharding decisions), and the changed-file list (shard grouping by directory).
- **Angle-specific needs, all derivable from the same command:**
  - _reuse_ needs rename detection or it flags moved files as duplicates → `-M` on the diff command, not a separate artifact.
  - _altitude_ needs the whole change at once → it gets the same command unsharded.
- **Quirk:** a PR-number target may not be checked out → "skip apply" branch in steps 1/6.

### fix-comments

- **Today:** same tokens as fix-quality (with the divergent `pr` fallback noted above).
- **Consumes:** the full diff text, from which it derives the changed-lines boundary itself (only comments on added/modified lines are in scope). Untracked files are "whole content added." All derivable from the same diff command plus the untracked list.
- **Quirk:** the step-3 `headRefOid` check — for PR-number targets, compare the PR head to local HEAD; mismatch → forced dry-run. Exists only because PR targets can name code that isn't checked out.

### fix-all

- **Consumes:** nothing itself — it parses the union of flags and routes. Its cost is the per-skill special-casing: step 2 exists solely because fix-correctness has no target.

### implement-plan (indirect consumer)

- Calls `fix-all local` and structures its whole commit discipline around the working-tree limitation. With a branch target available, phases could commit as they land and the fix passes would still see the full change.

## The design insight: share coordinates, not artifacts

Every consumer's artifact — Codex review input, agent-rerunnable diff command, changed-line ranges — derives from the same three coordinates:

    (base ref, pathspec, untracked-file list)

- fix-correctness: paths + base ref → run_review.mjs.
- fix-quality: `git diff -M <base> -- <paths>` is the command agents re-run; `--stat` and `--name-status` variants come free.
- fix-comments: runs the same command and parses hunks, exactly as it does now.

The resolver emits the coordinates and the canonical diff command. Each skill derives its own artifact. No single output shape has to serve three masters, which was the seed's unresolved problem — it dissolves rather than getting solved.

## Proposed design

### Shape: one skill, script-backed

A new skill `resolve-fix-target`, following the `create-plan-dir` pattern exactly: a SKILL.md that is the single source of truth for the target vocabulary, wrapping `scripts/resolve_target.sh` which does the deterministic work. Consumers invoke it as a skill —

    Skill(skill: "resolve-fix-target", args: "<the target arguments>")

— never by reaching into another skill's directory for the script. The SKILL.md tells the loaded context how to run the script and read its output; the script's output lands in the calling skill's context and its keys are used directly.

Each fix-\* skill's step 1 shrinks to: pull the target arguments out, invoke `resolve-fix-target`, state what resolved, use the emitted keys.

### Target vocabulary (adopts the seed's settled decisions)

- **`--local`** _(default when no target flag given)_ — uncommitted changes: `git diff HEAD` plus untracked files.
- **`--branch`** — merge-base with the trunk through to the working tree, uncommitted included. `--local` is a strict subset ("just my pending edits").
- **`--paths <pathspec>`** — a _filter_, never a standalone target. Composes with either flag above (`--branch --paths src/`); given alone, the script errors. See "Why --paths is a filter" below.
- **No PR targets.** To review PR #123, check out its branch and run `--branch`. This deletes, rather than centralizes, the two ugliest pieces of the current logic:
  - fix-comments' `headRefOid` check (step 3) — existed only because a PR number could name code that isn't checked out.
  - fix-quality's "PR not checked out → skip apply" branch (steps 1 and 6).
  - Every `gh` invocation and dirty-tree-vs-PR reconciliation in target resolution.

  With every target guaranteed local, an `EDITABLE` output key is unnecessary — resolution and applicability stop being separate questions.

Note the uniformity this buys: both targets are "diff from BASE_REF to working tree." `--local` is BASE_REF=HEAD; `--branch` is BASE_REF=merge-base. One code path, one output shape, one diff-command template.

### Script contract

`resolve_target.sh`, house style of `inspect_branch_state.sh` (KEY=value stdout, why-first comments, `set -uo pipefail`). Reporting only; never touches the tree.

Output on success (exit 0), shape not literal spec — the script is the source of truth:

    TARGET=local|branch
    BASE_REF=<sha>                      # HEAD's sha for --local; merge-base sha for --branch
    BASE_DESC=<human-readable>          # e.g. "merge-base with origin/main (a1b2c3d)"
    TOPLEVEL=C:/Users/Matt/code/repo    # from --show-toplevel, so C:/x not /c/x
    DIFF_CMD=git diff -M <sha> -- <pathspec>
    --- changed files ---
    <git diff --name-status output>
    --- untracked files ---
    <filtered git ls-files --others --exclude-standard output>

- `DIFF_CMD` is the string fix-quality pastes into agent prompts and fix-comments runs. `-M` is included so rename information is always present (the reuse angle's need), and it costs the other consumers nothing.
- The changed/untracked file lists are emitted because every consumer needs them (Codex paths, shard grouping, whole-content-added handling) and the script has already computed them — making each caller re-derive them from DIFF_CMD would be the duplication again in miniature.
- Trunk and merge-base detection copies the ~10-line remote/trunk resolution from `inspect_branch_state.sh` rather than importing it — a shared bash library across skill directories is exactly the cross-directory reaching this design avoids, and the logic is small and stable.

Failure modes:

- **Exit 1, reason on stderr** — empty resolution: clean tree under `--local`, no commits past merge-base and clean tree under `--branch`, `--paths` filtering everything out. The calling skill says "nothing to review" and stops. Emptiness is detected once, in one place, instead of three prose variants of "if the target has no changes, stop."
- **Exit 2, usage on stderr** — bad invocation: unknown flag, `--paths` alone, `--paths` matching nothing that exists, not a git repository. Mirrors run_review.mjs's philosophy: an empty scope stops rather than silently widening.

### Why `--paths` is a filter, not a target

The seed's "--paths downstream fallout" (altitude has no change to reason about; fix-comments pulls pre-existing comments into scope) only occurs if `--paths` alone can name _files_ as a target — a scope with no diff. Forbidding that dissolves both problems by construction:

- Every successful resolution has a diff, so fix-quality's altitude angle always has a change to reason about.
- fix-comments' changed-lines rule keeps working unmodified — a filtered diff still has hunks, and pre-existing comments stay out of scope exactly as before.

No per-skill carve-outs, no refusal logic in three places. "Review these files wholesale regardless of changes" is a genuinely different task from what the fix-\* family does (they are change reviewers), and if it's ever wanted it should be its own request, not a degenerate mode of this one.

## Per-consumer changes

### fix-correctness

- Gains the target vocabulary (today it has none). Step 1 invokes `resolve-fix-target`, passes the changed-file list and `BASE_REF` onward.
- **Requires extending `run_review.mjs`** — the one real code change outside the new skill. `collectFileContext` gains a `--base <ref>` option: with it, the staged/unstaged diff sections are replaced by `git diff <base> --no-ext-diff -- <files>`, which captures committed and uncommitted work in one hunk set. Small and contained: the function already takes the file list, already shells out to git, and this repo owns the script. Without `--base`, behavior is unchanged.

### fix-quality

- Step 1 collapses to: invoke resolver, use `DIFF_CMD` verbatim as the `<diff-command>` agent-prompt slot, use the changed-file list for shard grouping, run `DIFF_CMD --stat` for sizing.
- Delete: the `pr`/PR-number branches, the branch-diff fallback, the two-dot/three-dot guidance (the resolver's merge-base makes it moot), the "PR not checked out → skip apply" logic in steps 1 and 6, and the `gh pr view` intent-reading step (plan intent still arrives via `--plan`).

### fix-comments

- Step 1 collapses the same way; it runs `DIFF_CMD` and parses hunks as today. Untracked handling driven by the emitted untracked list.
- Delete: step 3's `headRefOid` check and the PR-target mode fallback. Mode determination reduces to just `--dry-run`.
- The divergent `pr` fallback disappears with the token itself.

### fix-all

- Passes the target flags through to all three passes verbatim — fix-correctness now takes them too. Step 2 ("note what the target means for fix-correctness") is deleted.
- The argument-routing table shrinks to: `--strictness` → fix-comments only; everything else → everyone.

### implement-plan (follow-up, not this change)

- Can drop the "leave everything uncommitted" constraint: commit per phase, run `fix-all --branch --plan <path>` at the end. Worth doing but separable; nothing here depends on it.

## What deliberately stays out of the resolver

- **Mode and judgment.** `--dry-run`, triage, apply-vs-defer, verification — all stay in each skill. The resolver answers "what change is in scope," nothing else.
- **Artifact production.** No ranges, no rendered diffs, no per-consumer output modes. The moment the resolver grows a `--format=ranges` flag, the seed's original problem is back.
- **`gh` and anything network.** Gone with PR targets.

## Costs and losses, stated plainly

- **One capability is lost:** dry-run-reviewing a PR you don't have checked out (`fix-quality 123 --dry-run` against a colleague's PR). The replacement is `gh pr checkout 123` first. If that workflow was never actually used, this costs nothing; if it was, it's one extra command.
- **One extra skill invocation per fix run.** Against three sub-agent fan-outs and a Codex review, the resolver's context cost is noise.
- **Descriptions and argument-hints change** on fix-quality, fix-comments, fix-all (dropping `pr | <pr-number-or-url>`, adding `--branch`/`--paths`), and fix-correctness (adding targets). User-visible vocabulary change; the old tokens should produce the exit-2 usage message, not silent fallback.

## Open questions

- **`--branch` trunk detection edge:** on the trunk itself, merge-base = HEAD, so `--branch` degenerates to `--local`. Correct behavior, but the script should say so in `BASE_DESC` rather than leaving the user to notice.
- **run_review.mjs `--base` + `--files` interaction with file contents:** the File Contents section currently sends working-tree contents, which is right for `--branch` too (the review target is "what the code is now vs base"). Confirm during implementation that nothing in the companion's prompt template assumes the diff is uncommitted.
- **Whether fix-all's tokens migrate in the same change** or the fix-\* skills accept both vocabularies for one transition period. Recommendation: hard cutover — these are personal skills with one user; a compatibility shim outlives its usefulness the day it's written.
