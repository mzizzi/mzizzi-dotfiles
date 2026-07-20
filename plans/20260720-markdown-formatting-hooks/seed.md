# Seed: markdown formatting via pre-commit + Prettier

## Goal

Many markdown files in this repo are AI-written and carry arbitrary hard line breaks and padding. Stop baking wrapping into the files: reflow every paragraph to one logical line and let editors soft-wrap. Two requirements:

1. **Ad-hoc**: reformat the whole repo (or one file) on demand.
2. **On commit**: an enforced check so unformatted markdown can't slip through.

Starting state: no formatting/linting tooling in the repo at all — no package.json, no pre-commit config, no custom git hooks. 26 tracked markdown files, many with load-bearing YAML frontmatter (SKILL.md, agent definitions).

## Decisions

### A formatter, not just a linter

- **Question:** what class of tool solves this?
- **Decision:** a formatter. Linters (markdownlint) only flag; joining hard-wrapped paragraph lines is a rewrite. Candidates that do it: Prettier with `"proseWrap": "never"`, or mdformat with `--wrap=no`.
- **Why:** both unwrap paragraphs while preserving intentional hard breaks (trailing backslash / two-space), code fences, and tables. The output the repo cares about is equivalent between them.

### Formatter: Prettier

- **Question:** Prettier or mdformat?
- **Decision:** Prettier.
- **Why:** the user already uses Prettier in other projects and wants one formatter everywhere. It also handles YAML frontmatter natively (mdformat needs `mdformat-frontmatter` + `mdformat-gfm` plugins). mdformat's edge — an officially maintained pre-commit hook while Prettier's mirror (`mirrors-prettier`) is archived — is neutralized by the local-hook pattern below.

### Hook entry point: the pre-commit framework, not husky

- **Question:** what enforces the check on commit — husky + lint-staged (Node stack) or the pre-commit framework?
- **Decision:** pre-commit owns `.git/hooks/`; Prettier runs as a `repo: local` hook with `language: node`. No package.json, no node_modules, no husky.
- **Why:** this is a polyglot dotfiles repo, not a Node project — a package.json/lockfile/node_modules workflow just to format markdown is more moving parts than one YAML file. pre-commit builds a nodeenv in its cache and npm-installs the pinned Prettier itself; the version pin lives in `additional_dependencies` (a literal npm spec). Bonus: pre-commit's hook ecosystem (`check-yaml`, `trailing-whitespace`, `markdownlint-cli2`) becomes a few lines of YAML each, later.
- **Coexistence note (if husky ever appears):** both frameworks fight over the git entry point — husky sets `core.hooksPath`, which makes git ignore `.git/hooks/`, and `pre-commit install` refuses to run when it detects that. One must be the runner: either husky's script calls `pre-commit run`, or (as here) pre-commit is the entry point and Node tools run as local hooks.

### Config sketch

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: prettier
        name: prettier
        entry: prettier --write
        language: node
        types: [markdown]
        additional_dependencies: ["prettier@3.6.2"]
```

Plus `.prettierrc` with `"proseWrap": "never"`. The `.prettierrc` stays canonical — editor Prettier plugins and the hook read the same config, so format-on-save and commit-time enforcement agree by construction.

### Mechanics worth remembering

- `prettier --write` exits 0 even when it rewrites files, but pre-commit checksums files around each hook and fails on modification ("files were modified by this hook"). The commit aborts with fixes in the working tree; re-stage and commit again. Slightly more friction than lint-staged's silent auto-restage, but the formatter's changes are always seen before landing.
- Ad-hoc runs: `pre-commit run --all-files` (or run Prettier directly — the hook only cares that files are formatted, not how).
- Per-machine: install pre-commit once (pipx). Per-clone: `pre-commit install`. Enforcement has the same gap as every client-side hook framework: a clone where install wasn't run has no hook.
- First `pre-commit run` is slow (nodeenv build); cached after.
- Scope starts at `types: [markdown]`; widening to YAML/JSON later is a one-line change to `types_or`.

## Rollout order

1. Write `.pre-commit-config.yaml` and `.prettierrc`.
2. Run Prettier across the repo as its own dedicated commit — the one-time churn (bullet markers, spacing, unwrapping) shouldn't tangle with real changes. Skim the diff on `plugins/mzizzi/**`: Prettier preserves frontmatter, but those blocks are load-bearing for the Claude setup.
3. `pre-commit install` — after the reformat, so the hook never fights pre-existing formatting.
4. Editor side: enable soft wrap for markdown (VS Code: `"[markdown]": { "editor.wordWrap": "on" }`).

## Open questions

- **Add markdownlint-cli2 as a second layer?** Catches structure issues formatting can't (heading hierarchy, bare URLs). Would need MD013 (line length) disabled, since one-line-per-paragraph deliberately violates it. Deferred until formatting alone proves insufficient.
- **Widen scope beyond markdown?** Prettier could own JSON/YAML here too. Deferred to keep the initial diff contained.
