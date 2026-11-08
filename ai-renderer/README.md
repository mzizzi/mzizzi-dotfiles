# AI resource renderer

Render shared skills and agents from `ai/` into Claude plugins and Pi packages. Generated files live under Git-ignored `generated/`. The pre-commit hook renders both targets before every commit.

## Run

Use Python 3.11 or newer:

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

## Check loaders

With Claude, Pi, and `pi-subagents` installed:

```bash
node ai-renderer/tests/check_ai_loaders.mjs
```

This checks repeated local package installation and discovery without model requests. Pi agents need `pi-subagents`; core Pi alone does not load them. Renderer fixtures live under `tests/fixtures/source/`, outside the normal `ai/` sources.

Pi now renders `prepare-feature-branch`, `implement-plan`, and `review-pr` as an interactive pilot. Install the user-level [worktree extension](../config/pi/README.md#worktrees-interactive-pilot) before use. Implementation also needs the local task extension and `pi-subagents`; other review workflows can use a conversation checklist without task tools. Human questions use plain text when no question tool exists.

Branch selection and the shared uncommitted diff stay unchanged. Worktree entry replaces the Pi session ID/file and pauses until completion. Finish all child work before switching. Worktrees stay after shutdown; PR cleanup refuses forced removal without approval. Dirty source plans absent from the destination need a transfer decision. Full model-driven workflow checks remain manual pilot gates.

Pi workflows read nested skills directly and use native subagents for delegation. Codex review still needs the installed `codex@openai-codex` Claude plugin and an authenticated Codex CLI.

The sources are staging copies. Sandbox startup renders and registers the Pi package at a stable user-level path; see [sandbox setup](../sandbox/README.md). Existing production Claude plugins and host settings stay unchanged. Read-only review remains a prompt instruction, not an enforced sandbox. Model policy: Claude Fable/medium maps to Pi Astra/medium; Claude Opus 5.5/medium maps to Pi Sol 6.1/high. Set these explicitly in each agent template.
