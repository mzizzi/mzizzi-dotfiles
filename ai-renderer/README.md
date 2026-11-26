# AI resource renderer

Render shared skills and agents into Claude plugins and Pi packages, or render a consumer repository's native project skills. Use Python >=3.11 and install the [renderer requirements](requirements.txt). Run `python ai-renderer/render_ai.py --help` for options. Explicit paths resolve from the caller's working directory.

## Dotfiles packages

Run from the dotfiles root:

```bash
python -m pip install -r ai-renderer/requirements.txt
python ai-renderer/render_ai.py --layout package --input ai --output ai-rendered/claude --target claude
python ai-renderer/render_ai.py --layout package --input ai --output ai-rendered/pi --target pi
python ai-renderer/render_ai.py --layout package --input ai --output ai-rendered/claude --target claude --check
python ai-renderer/render_ai.py --layout package --input ai --output ai-rendered/pi --target pi --check
```

Review the source and output diff and stage only intended paths. See `--help` for the script-relative package invocation. Do not edit `ai-rendered/` directly. The retired `generated/` cache stays ignored and is never removed automatically. Production `plugins/`, marketplace registration, and Windows Claude loading remain unchanged.

### Package sources

- Skills: `ai/<namespace>/skills/<name>/SKILL.md.j2`, with supporting files beside it.
- Agents: `ai/<namespace>/agents/<name>.md.j2`.
- Claude plugin manifest: optional `ai/<namespace>/manifest.yaml`. Its `claude` block adds fields to the rendered `.claude-plugin/plugin.json`; `CLAUDE_MANIFEST_FIELDS` in `render_ai.py` defines supported fields. Pi `package.json` is derived from the rendered resources.
- Skill-only template fragments: `_templates/` inside the skill directory. Jinja can include them; the renderer does not emit that directory.
- Frontmatter: shared description plus explicit `claude` and `pi` blocks. `TARGET_FIELDS`, `AGENT_FIELDS`, and `AGENT_CHOICES` in `render_ai.py` define supported metadata.

Use `Skill("name")` and `Agent("name")` for references; qualify another namespace as `"namespace:name"`. Helpers render names, not invocations or preloads. Includes and model aliases come from the package input root.

## Native project skills

Pin the renderer in the consumer repository's setup and install its requirements. From the consumer checkout, with `renderer` pointing to the pinned script:

```bash
python "$renderer" --input ai/project/skills --output .claude/skills --target claude
python "$renderer" --input ai/project/skills --output .pi/skills --target pi
```

Put each template at `<input>/<name>/SKILL.md.j2` and supporting files beside it. Includes resolve from the input root, so `{% include "<name>/_templates/" ~ target ~ ".md.j2" %}` can select target-specific text without emitting the `_templates/` directory. Output is a native skills tree, with no agents, plugin manifests, or package settings. Use bare `Skill("name")` references within the input catalog. Use target-specific text for external skills and agents; the renderer does not check whether they are installed. Project templates have no model aliases.

Both layouts render `.j2` files and copy other skill resources unchanged. Set a target block to `false` to omit that resource. Unknown references, references from included resources to omitted resources, unsupported metadata, multiline frontmatter fields, collisions, and symlinks stop generation.

Keep generated text and ownership markers at LF in the worktree. For example, add these rules to the consumer's `.gitattributes`:

```gitattributes
.claude/skills/** text=auto eol=lf
.pi/skills/** text=auto eol=lf
```

Give copied text files the same checkout line endings in the input and output trees. Mark binary assets explicitly if Git does not detect them as binary.

Use a separate output tree for each harness. Output must not overlap the input or go through a symlink or junction. An absent or empty tree can be generated; a nonempty tree must already have the project ownership marker. The renderer replaces the entire marked tree, including untracked files without sources.

For migration, move skill files to the input and other maintained files outside the output. Move the old output aside in a disposable worktree, then render and review the replacement. Use `--check` in CI or hooks to report drift without writing. If it reports drift, inspect the paths and move any manual files you want to keep out of the output before you render. Neither command stages files; the consumer owns Git policy.

## Commit and push checks

Install both local hook types, including in existing clones:

```bash
python -m pip install pre-commit
python -m pre_commit install --install-hooks
```

The [hook configuration](../.pre-commit-config.yaml) pins isolated Python and Node dependencies for rendering, formatting, and lint. Manual rendering uses [the renderer requirements](requirements.txt). Repeating installation is safe. Sandbox setup runs the same installation with the `pre-commit` executable.

Commit order: format selected authored Markdown, check the AI candidate, check all output Markdown formatting, then lint all output Markdown. Push order: check the AI candidate against `HEAD`, check all output formatting and lint, then check selected authored Markdown. Candidate failure stops downstream hooks. No AI hook renders in write mode, stages files, or formats output in write mode.

Both hooks use the renderer's dotfiles-only candidate mode. To check the visible commit candidate directly, run `python ai-renderer/render_ai.py --check-candidate commit`. Plain `--check` compares rendered output without consulting Git; use it for consumer projects.

Candidate checks require relevant tracked files to match the index before checking the rendered package trees. They reject untracked files at all relevant paths, including ignored resources, and unsupported `assume-unchanged` / `skip-worktree` flags on relevant tracked files. See `DOTFILES_CANDIDATE_PATHS` in `render_ai.py` for the exact scope. POSIX checks compare executable bits even with `core.filemode=false`; Windows retains the renderer's platform behavior. Unrelated local files are allowed.

Push checks additionally require relevant index files to match `HEAD`: staging repaired output does not repair a stale committed candidate. Installed hooks may hide unstaged tracked edits temporarily; they check the visible candidate, not every hidden local edit. Manual all-files runs do not hide those edits and report a stage-or-restore error:

```bash
python -m pre_commit run --all-files
python -m pre_commit run --all-files --hook-stage pre-push
```

Use the [package commands above](#dotfiles-packages) to repair stale output. For output formatting/lint failures, fix authored templates/resources and render again. Never hand-edit output or run `prettier --write` on it. Commit the reviewed repair before retrying a push. Clear unsupported flags with `git update-index --no-assume-unchanged --no-skip-worktree -- <path>`. Stage intended new resources, including deliberately ignored resources, or remove unintended files from the source/output trees.

These local hooks can be bypassed with `--no-verify`, `SKIP`, or missing installation. Push checks cover the normal checked-out-branch workflow only, not arbitrary other branches, all refs in a multi-ref push, or every intermediate commit. They are not server-side enforcement or CI.

### Output Markdown policy

Formatting and lint always scan all `ai-rendered/**/*.md`, regardless of selected filenames. Prettier reads the explicit root `.prettierrc` / `.prettierignore`; markdownlint reads `.markdownlint-cli2.yaml` with fixes disabled. Templates are not linted as Markdown. Lint uses default rules except MD013 because paragraphs are intentionally unwrapped. Entrypoints allow `name` frontmatter in place of an H1 while still rejecting multiple actual H1 headings; supporting references keep ordinary heading rules. Frontmatter stays one physical line per field for Pi.

Only these two vendored output files are exempt from both tools; the source vendored prompt also keeps its existing Prettier exclusion:

- `ai-rendered/claude/plugins/mzizzi/skills/adversarial-review/references/adversarial-review.md`
- `ai-rendered/pi/packages/mzizzi/skills/adversarial-review/references/adversarial-review.md`

Other references remain checked. Rendering still compares exact bytes and modes without a Node dependency or formatting transform.

## Check loaders

With pre-commit and Node >=22 installed, run the Python suite:

```bash
python -m unittest discover -s ai-renderer/tests
```

With Claude and Pi installed, check local package and native project discovery without model requests. The package check also needs `pi-subagents`; core Pi alone does not load package agents. The project check renders a disposable trusted checkout and uses `PYTHON` if the renderer dependencies are installed in a different interpreter.

```bash
node ai-renderer/tests/check_ai_loaders.mjs
node ai-renderer/tests/check_project_loaders.mjs
```

Renderer fixtures live under `tests/fixtures/`, outside the normal `ai/` sources.

Pi now renders `prepare-feature-branch`, `implement-plan`, and `review-pr` as an interactive pilot. Install the user-level [worktree extension](../config/pi/README.md#worktrees-interactive-pilot) before use. Implementation also needs the local task extension and `pi-subagents`; other review workflows can use a conversation checklist without task tools. Human questions use plain text when no question tool exists.

To delegate `implement-plan`, prepare the plan's feature checkout first. Start `mzizzi.standard` with that checkout as `cwd` and its tracked plan as the input. The child delegates phases and reviews there without switching the parent session. The checkout must start clean and have one writer. Normal depth and spawn limits still apply.

Branch selection and the shared uncommitted diff stay unchanged. Worktree entry replaces the Pi session ID/file and pauses until completion. Finish all child work before switching. Worktrees stay after shutdown; PR cleanup refuses forced removal without approval. Dirty source plans absent from the destination need a transfer decision. Local runtime checks cover real terminal entry/return, one late-input race, child/supervisor coordination, and cwd-bound MCP reconnection. Full model-driven workflow checks remain pilot gates.

The [quality review skill](../ai/mzizzi/skills/fix-quality/SKILL.md.j2) disables acceptance attestation per review call so it cannot replace the requested report. The shared `standard` agent also writes implementations, so this policy belongs to each review call rather than the agent's global settings. The skill owns the invocation and report contract.

Pi workflows read nested skills directly and use native subagents for delegation. The shared `adversarial-review` skill uses one prompt, report schema, outcome contract, and formatter. Claude still needs the installed `codex@openai-codex` plugin and authenticated Codex CLI. Pi uses a fresh Astra/high child through `pi-subagents`, without those Codex dependencies. Its `outputSchema` and `structured_output` tool come from `pi-subagents`, not Pi core. Both return `complete` with a report or `unavailable` with a reason; failure never counts as approval.

Run the bundled regression checks after rendering:

```bash
node ai-rendered/claude/plugins/mzizzi/skills/adversarial-review/scripts/tests/test_run_review.mjs
node ai-rendered/pi/packages/mzizzi/skills/adversarial-review/scripts/tests/test_run_review.mjs
```

The sources are staging copies for the production plugin port. Sandbox startup registers the checkout as a Pi package, so Pi loads the rendered resources in the working tree; see [sandbox setup](../sandbox/README.md). Existing production Claude plugins and host settings stay unchanged. Reviewers receive instructions not to change target files. Model policy: Claude Fable/medium maps to Pi Astra/medium; Claude Opus 5.5/medium maps to Pi Sol 6.1/high. Set these explicitly in each agent template.
