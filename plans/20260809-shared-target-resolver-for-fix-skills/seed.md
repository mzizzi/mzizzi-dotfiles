# Shared target resolver for the fix-\* skills — Seed

## Intent

Factor the target-resolution logic duplicated across `fix-quality`, `fix-comments`, `fix-correctness`, and `fix-all` into one script-backed skill. **This premise is not yet validated** — see below.

## The core unresolved problem: the child skills need different artifacts

Every attempt to pick one output shape failed because the three consumers want fundamentally different things:

- **`fix-correctness`** needs a **real diff**. Before/after and deleted lines are the substance of a correctness review ("you removed the null check"). It also doesn't consume ranges at all — Codex builds its own review input from paths plus a base ref.
- **`fix-quality`** needs a **scope**, not a diff. Its angles judge current code. But the reuse angle needs rename information (or it flags moved files as duplicates), and the altitude angle needs the whole change at once and can't shard.
- **`fix-comments`** needs the **changed-lines boundary** specifically — which lines are new or modified — and nothing wider. Ranges fit it and nothing else does.

Every single-artifact proposal so far serves one consumer and degrades the other two. A range list starves `fix-correctness`. A full diff is what `fix-quality` least needs. A file list breaks `fix-comments`' core rule.

**Open question before any of the below matters:** is a single shared resolver the right shape, or should this be a resolver that emits several artifacts, or a small shared library each skill calls differently? Nothing here is settled until that is.

## Settled (conditional on the above)

- **Flags: `--local`, `--branch`, `--paths`.**
- **No PR targets.** Caller checks out the branch and uses `--branch`. Keeps `gh` and dirty-tree handling out of the resolver. Deletes `fix-comments`' `headRefOid` check and `fix-quality`'s "PR not checked out → skip apply" branch.
- **`--branch` = merge-base to working tree, includes uncommitted.** So `--local` is a strict subset, meaning "just my pending edits."
- Bash script, house style of `inspect_branch_state.sh`. Empty resolution → non-zero exit, reason on stderr. Paths printed as `C:/x` (from `--show-toplevel`), not `/c/x`.

## Also open

- **Do flags compose?** `--branch --paths src/` as a pathspec filter. Free in git; never decided.
- **`--paths` downstream fallout.** `fix-quality`'s altitude angle has no change to reason about. `fix-comments` would put pre-existing comments in scope. Each needs a carve-out or a refusal.
- **`fix-correctness` + `--branch`.** `run_review.mjs --files` sends staged/unstaged diffs only; committed branch work never reaches Codex.
