# AI resource sources

Keep shared skills under `<namespace>/skills/<local-name>/SKILL.md.j2` with their supporting resources. Keep shared agents under `<namespace>/agents/<local-name>.md.j2`.

These are authored staging sources for the mzizzi plugin port. `ai-renderer/` owns transformation and checks; `ai-rendered/` contains complete committed output for both targets. Production copies under `plugins/mzizzi/` and their marketplace/Windows loading remain active and unchanged. Sandbox startup still generates and registers `ai-rendered/pi/packages/mzizzi` for pilot use. Renderer fixtures live under `ai-renderer/tests/fixtures/source/`, not here.

After edits, run `python ai-renderer/render_ai.py` and `python ai-renderer/render_ai.py --check` from the repo root, review the source/output diff, and stage intended paths explicitly. Commit and push hooks check the candidate and all rendered Markdown without writing output or staging files. Fix formatting/lint in these sources and render again; do not edit or format `ai-rendered/` directly. The two vendored review-prompt output copies are the only output Markdown exceptions; other references remain checked.

Hook installation needs Python >=3.11, Node >=22, and pre-commit. Run `python -m pre_commit install --install-hooks` in existing clones as well as new ones to install both hook types. Dependencies and repair/push-scope details are in the renderer documentation.

See [the renderer documentation](../ai-renderer/README.md) for authoring, generation, and loader checks.
