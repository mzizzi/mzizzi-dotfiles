# AI resource sources

Keep shared skills under `<namespace>/skills/<local-name>/SKILL.md.j2` with their supporting resources. Keep shared agents under `<namespace>/agents/<local-name>.md.j2`.

These are the authored sources for the mzizzi Claude plugin and Pi package. `ai-renderer/` owns transformation and checks; `ai-rendered/` contains complete committed output for both targets and is what gets loaded: the marketplace and the Windows `claude` shim load `ai-rendered/claude/plugins/mzizzi`, and sandbox setup registers `ai-rendered/pi/packages/mzizzi` with Pi. Renderer fixtures live under `ai-renderer/tests/fixtures/source/`, not here.

After edits, follow the [package render workflow](../ai-renderer/README.md#dotfiles-packages). Fix formatting and lint in the source, not the output. See the [output Markdown policy](../ai-renderer/README.md#output-markdown-policy) for what the hooks check.

Use the [hook setup](../README.md#markdown-formatting) in new and existing clones.

See [the renderer documentation](../ai-renderer/README.md) for authoring, generation, and loader checks.
