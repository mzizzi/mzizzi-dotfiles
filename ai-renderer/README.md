# AI resource renderer

Keep adopted AI resource sources under `ai/`. Render them into Claude plugins and Pi packages without maintaining separate instructions for each harness.

The current renderer handles skills only. `mzizzi/skills/renderer-example` is a loader fixture, not a migrated production skill. Agents, shared rule deployment, and installation remain separate phases. Existing plugins and installed settings stay unchanged.

## Run

Use Python 3.11 or newer in a virtual environment:

```bash
python -m venv venv
venv/bin/python -m pip install -r ai-renderer/requirements.txt
venv/bin/python ai-renderer/render_ai.py
venv/bin/python ai-renderer/render_ai.py --check
venv/bin/python -m unittest discover -s ai-renderer/tests
```

On Windows, use `venv\Scripts\python.exe` instead of `venv/bin/python`.

The `render-ai` pre-commit hook renders both targets before every commit, including commits without AI source changes. Pre-commit installs the renderer dependencies in its own Python environment. Rendering errors block the commit; generated output stays Git-ignored. Agent-lab installs hooks and their environments at startup. For other environments, see the [repository hook setup](../README.md).

Run `python ai-renderer/render_ai.py --help` for CLI options. Generation resolves repository paths from the script, so it also works from another directory.

Generated files live under `generated/claude/plugins/` and `generated/pi/packages/`. These directories are build artifacts, not editable sources. The renderer marks owned target trees and refuses to replace unrelated files. Template failures preserve previous output. Each selected target publishes separately; a filesystem failure during a later target does not roll back an earlier published target. Directory replacement is not a cross-platform atomic transaction.

## Write a skill

Create `ai/<namespace>/skills/<local-name>/SKILL.md.j2`. Paths define identities; do not repeat names in metadata or a registry.

Use ordinary Markdown with YAML frontmatter. Shared metadata describes the skill. Target blocks hold fields whose meaning or support differs between harnesses. `TARGET_FIELDS` and `parse_skill` in `ai-renderer/render_ai.py` define the accepted metadata. Unsupported keys stop generation, including unsupported keys in an unselected target block.

Use references inside prose:

```jinja2
Load {{ Skill("review") }} before changing the code.
Load {{ Skill("other-package:review") }} for another package's review.
```

An unqualified reference stays within its source namespace. Claude references use plugin-qualified names; Pi references use local skill names without a namespace prefix. Unknown references and duplicate Pi skill names across namespaces stop generation. Helpers return Markdown reference phrases, not tool calls or invocation recipes.

Only `.j2` files receive Jinja rendering. The renderer removes that suffix in output. Other resources remain byte-identical, including text that resembles Jinja syntax. Keep supporting file references relative to the loaded skill directory. Source symlinks and output collisions stop generation. Script permissions survive where the filesystem supports them.

Templates use strict undefined variables and no HTML escaping. Source templates are trusted repository code, not an input sandbox.

## Check loaders

Generate before a loader check. Use temporary home/configuration directories; do not install fixture packages into normal settings.

For Claude, check the generated plugin with the installed CLI:

```bash
claude plugin validate generated/claude/plugins/mzizzi
```

For Pi, `ai-renderer/tests/check_ai_loaders.mjs` exercises its installed skill and package loaders. It also checks the Claude plugin inventory. Both harnesses must be installed:

```bash
node ai-renderer/tests/check_ai_loaders.mjs
```

The minimal Claude manifest can produce advisory warnings for publication metadata. Loader checks make no model requests. Package discovery does not prove that a model follows the skill instructions.
