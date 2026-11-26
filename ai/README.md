# AI resource sources

Keep shared skills under `<namespace>/skills/<local-name>/SKILL.md.j2` with their supporting resources. Keep shared agents under `<namespace>/agents/<local-name>.md.j2`.

These are the authored sources for the mzizzi Claude plugin and Pi package. `ai-renderer/` owns transformation and checks; `ai-rendered/` contains complete committed output for both targets and is what gets loaded: the marketplace and the Windows `claude` shim load `ai-rendered/claude/plugins/mzizzi`, and sandbox setup registers `ai-rendered/pi/packages/mzizzi` with Pi. Renderer fixtures live under `ai-renderer/tests/fixtures/source/`, not here.

After edits, run `python ai-renderer/render_ai.py` and `python ai-renderer/render_ai.py --check` from the repo root, review the source/output diff, and stage intended paths explicitly. Commit and push hooks check the candidate and all rendered Markdown without writing output or staging files. Fix formatting/lint in these sources and render again; do not edit or format `ai-rendered/` directly. The two vendored review-prompt output copies are the only output Markdown exceptions; other references remain checked.

Hook installation needs Python >=3.11, Node >=22, and pre-commit. Run `python -m pre_commit install --install-hooks` in existing clones as well as new ones to install both hook types. Dependencies and repair/push-scope details are in the renderer documentation.

See [the renderer documentation](../ai-renderer/README.md) for authoring, generation, and loader checks.
