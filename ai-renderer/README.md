# AI resource renderer

Render shared skills and agents from authored `ai/` sources into complete committed packages under `ai-rendered/claude/plugins/` and `ai-rendered/pi/packages/`. `ai-renderer/` owns transformation and checks; `ai-rendered/` is consumable output, not an editing location. The retired `generated/` cache stays ignored and is never removed automatically. Production `plugins/`, marketplace registration, and Windows Claude loading remain unchanged.

## Run

Use Python >=3.11. Hooks and real-tool tests also need pre-commit and Node >=22:

```bash
python -m pip install -r ai-renderer/requirements.txt
python ai-renderer/render_ai.py
python ai-renderer/render_ai.py --check
python -m unittest discover -s ai-renderer/tests
```

Run `python ai-renderer/render_ai.py --help` for options. Paths resolve from the script, not the working directory.

## Sources

- Skills: `ai/<namespace>/skills/<name>/SKILL.md.j2`, with supporting files beside it.
- Agents: `ai/<namespace>/agents/<name>.md.j2`.
- Skill-only template fragments: `_templates/` inside the skill directory. Jinja can include them; the renderer does not emit that directory.
- Frontmatter: shared description plus explicit `claude` and `pi` blocks. `TARGET_FIELDS`, `AGENT_FIELDS`, and `AGENT_CHOICES` in `render_ai.py` define supported metadata.

Use `Skill("name")` and `Agent("name")` for references; qualify another namespace as `"namespace:name"`. Helpers render names, not invocations or preloads. Templates receive `target` (`claude` or `pi`). Set a target block to `false` to omit that resource; references to omitted resources fail generation. The renderer renders `.j2` files and copies other skill resources unchanged. Unknown references, unsupported metadata, multiline frontmatter fields, collisions, and symlinks stop generation.

## Commit and push checks

Install both local hook types, including in existing clones:

```bash
python -m pip install pre-commit
python -m pre_commit install --install-hooks
```

The [hook configuration](../.pre-commit-config.yaml) pins isolated Python and Node dependencies for rendering, formatting, and lint. Manual rendering uses [the renderer requirements](requirements.txt). Repeating installation is safe. Sandbox setup runs the same installation with the `pre-commit` executable.

Commit order: format selected authored Markdown, check the AI candidate, check all output Markdown formatting, then lint all output Markdown. Push order: check the AI candidate against `HEAD`, check all output formatting and lint, then check selected authored Markdown. Candidate failure stops downstream hooks. No AI hook renders in write mode, stages files, or formats output in write mode.

`check_ai.py` requires relevant tracked files to match the index before calling `build(..., check=True)`. It rejects untracked files at all relevant paths, including ignored resources, and unsupported `assume-unchanged` / `skip-worktree` flags on relevant tracked files. Relevant paths include both trees, renderer/check implementation and requirements, hook/Markdown configuration, `.gitattributes`, and `.gitignore`; the exact policy lives in `check_ai.py`. POSIX checks compare executable bits even with `core.filemode=false`; Windows retains the renderer's platform behavior. Unrelated local files are allowed.

Push checks additionally require relevant index files to match `HEAD`: staging repaired output does not repair a stale committed candidate. Installed hooks may hide unstaged tracked edits temporarily; they check the visible candidate, not every hidden local edit. Manual all-files runs do not hide those edits and report a stage-or-restore error:

```bash
python -m pre_commit run --all-files
python -m pre_commit run --all-files --hook-stage pre-push
```

Repair stale output explicitly:

```bash
python ai-renderer/render_ai.py
python ai-renderer/render_ai.py --check
git diff -- ai/ ai-rendered/
# Stage only intended paths after review.
git add ai/<changed-source> ai-rendered/<changed-output>
```

For output formatting/lint failures, fix authored templates/resources and render again. Never hand-edit output or run `prettier --write` on it. Commit the reviewed repair before retrying a push. Clear unsupported flags with `git update-index --no-assume-unchanged --no-skip-worktree -- <path>`. Stage intended new resources, including deliberately ignored resources, or remove unintended files from the source/output trees.

These local hooks can be bypassed with `--no-verify`, `SKIP`, or missing installation. Push checks cover the normal checked-out-branch workflow only, not arbitrary other branches, all refs in a multi-ref push, or every intermediate commit. They are not server-side enforcement or CI.

### Output Markdown policy

Formatting and lint always scan all `ai-rendered/**/*.md`, regardless of selected filenames. Prettier reads the explicit root `.prettierrc` / `.prettierignore`; markdownlint reads `.markdownlint-cli2.yaml` with fixes disabled. Templates are not linted as Markdown. Lint uses default rules except MD013 because paragraphs are intentionally unwrapped. Entrypoints allow `name` frontmatter in place of an H1 while still rejecting multiple actual H1 headings; supporting references keep ordinary heading rules. Frontmatter stays one physical line per field for Pi.

Only these two vendored output files are exempt from both tools; the source vendored prompt also keeps its existing Prettier exclusion:

- `ai-rendered/claude/plugins/mzizzi/skills/adversarial-review/references/adversarial-review.md`
- `ai-rendered/pi/packages/mzizzi/skills/adversarial-review/references/adversarial-review.md`

Other references remain checked. Rendering still compares exact bytes and modes without a Node dependency or formatting transform.

## Check loaders

With Claude, Pi, and `pi-subagents` installed:

```bash
node ai-renderer/tests/check_ai_loaders.mjs
```

This checks repeated local package installation and discovery without model requests. Pi agents need `pi-subagents`; core Pi alone does not load them. Renderer fixtures live under `tests/fixtures/source/`, outside the normal `ai/` sources.

Pi now renders `prepare-feature-branch`, `implement-plan`, and `review-pr` as an interactive pilot. Install the user-level [worktree extension](../config/pi/README.md#worktrees-interactive-pilot) before use. Implementation also needs the local task extension and `pi-subagents`; other review workflows can use a conversation checklist without task tools. Human questions use plain text when no question tool exists.

Branch selection and the shared uncommitted diff stay unchanged. Worktree entry replaces the Pi session ID/file and pauses until completion. Finish all child work before switching. Worktrees stay after shutdown; PR cleanup refuses forced removal without approval. Dirty source plans absent from the destination need a transfer decision. Local runtime checks cover real terminal entry/return, one late-input race, child/supervisor coordination, and cwd-bound MCP reconnection. Full model-driven workflow checks remain pilot gates.

The [quality review skill](../ai/mzizzi/skills/fix-quality/SKILL.md.j2) disables acceptance attestation per review call so it cannot replace the requested report. The shared `standard` agent also writes implementations, so this policy belongs to each review call rather than the agent's global settings. The skill owns the invocation and report contract.

Pi workflows read nested skills directly and use native subagents for delegation. The shared `adversarial-review` skill uses one prompt, report schema, outcome contract, and formatter. Claude still needs the installed `codex@openai-codex` plugin and authenticated Codex CLI. Pi uses a fresh Astra/high child through `pi-subagents`, without those Codex dependencies. Its `outputSchema` and `structured_output` tool come from `pi-subagents`, not Pi core. Both return `complete` with a report or `unavailable` with a reason; failure never counts as approval.

Run the bundled regression checks after rendering:

```bash
node ai-rendered/claude/plugins/mzizzi/skills/adversarial-review/scripts/tests/test_run_review.mjs
node ai-rendered/pi/packages/mzizzi/skills/adversarial-review/scripts/tests/test_run_review.mjs
```

The sources are staging copies for the production plugin port. Sandbox startup renders and registers `ai-rendered/pi/packages/mzizzi` at a stable user-level path; see [sandbox setup](../sandbox/README.md). Existing production Claude plugins and host settings stay unchanged. Reviewers receive instructions not to change target files. Model policy: Claude Fable/medium maps to Pi Astra/medium; Claude Opus 5.5/medium maps to Pi Sol 6.1/high. Set these explicitly in each agent template.
