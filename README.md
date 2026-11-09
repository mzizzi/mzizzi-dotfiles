# mzizzi-dotfiles

Personal Claude Code plugin marketplace and dotfiles.

## Plugins

- `plugins/mzizzi` — planning and review workflow skills (brainstorm, create-plan, create-plan-dir, retro). Published via `.claude-plugin/marketplace.json` for anyone installing it the normal way through a Claude Code marketplace.
- `plugins/mzizzi-claude` — tools for maintaining Claude Code setups (audit-skills). Depends on `mzizzi` for its agent tiers and `create-plan-dir`.

## Windows setup

`scripts/windows/install.ps1` wires the local `claude` CLI to always load this repo's `plugins/mzizzi` plugin straight from this checkout (via a PowerShell profile function), without installing it from a marketplace -- useful when iterating on the plugin's own skills. Run once from the repo root:

    .\scripts\windows\install.ps1

Safe to re-run any time, including after moving or re-cloning the repo -- it self-heals the profile line instead of duplicating it. See the script itself for other options (including uninstalling).

## Markdown formatting

Markdown here is stored one logical line per paragraph -- editors soft-wrap it, so a one-word edit no longer reshuffles a paragraph's wrap points into a multi-line diff. Prettier does the reflowing and `.prettierrc` is the contract, read by the git hook and by any editor Prettier plugin alike. The hook is authoritative: it pins its own Prettier version, while an editor plugin uses whatever version it ships with, so the two can still disagree on output the pin has changed. If format-on-save keeps producing edits the hook then rewrites, match your editor's Prettier to the version pinned in `.pre-commit-config.yaml`.

[pre-commit](https://pre-commit.com) manages local commit and push hooks. It installs isolated Python and Node dependencies pinned in [the hook configuration](.pre-commit-config.yaml). Manual rendering uses [the renderer requirements](ai-renderer/requirements.txt). Setup needs Python >=3.11 and Node >=22. No root `package.json` or `node_modules` is needed.

Per machine, once:

    python -m pip install --user pre-commit

Per clone, once, from the repo root:

    python -m pre_commit install --install-hooks

This installs both `pre-commit` and `pre-push`. Existing clones must rerun this command to receive the push hook; repeating it is safe. Use `python -m pre_commit ...` rather than the `pre-commit` shim: a `--user` install puts the shim somewhere that is not necessarily on PATH. The generated git hook is unaffected -- it embeds an absolute path to the Python that installed it.

To format authored Markdown by hand (after changing `.prettierrc`, say):

    python -m pre_commit run prettier --all-files

The commit hook formats selected authored Markdown first, then checks the AI candidate and all rendered Markdown. The push hook checks the AI candidate, all rendered Markdown, and selected authored Markdown without writing files. Neither hook stages files or writes rendered output. For the full checks:

    python -m pre_commit run --all-files
    python -m pre_commit run --all-files --hook-stage pre-push

Manual runs see unstaged relevant files and require you to stage or restore them. Installed hooks can temporarily hide unstaged tracked changes; they validate the candidate, not every local edit.

These are bypassable local hooks, not server-side enforcement or CI. Clones without installation and `git commit --no-verify` / `git push --no-verify` bypass them; `SKIP=<hook-id>` skips individual checks. Push validation covers the checked-out branch's current committed candidate, not arbitrary other branches, every ref in a multi-ref push, or every intermediate commit.

### Rendered AI packages

`ai/` owns authored templates/resources, `ai-renderer/` owns rendering and candidate checks, and committed `ai-rendered/` owns complete Claude plugins and Pi packages. Do not edit output directly or run a formatter's write mode on it. The ignored `generated/` directory is a retired local cache; it is not removed automatically.

After changing a source, install the manual renderer dependencies and regenerate both targets:

```bash
python -m pip install -r ai-renderer/requirements.txt
python ai-renderer/render_ai.py
python ai-renderer/render_ai.py --check
# Review the diff, then explicitly stage the intended source and output paths.
git add ai/<changed-source> ai-rendered/<changed-output>
```

If output formatting or lint fails, fix the source and render again. The output checks cover every rendered Markdown file except the two exact vendored `adversarial-review/references/adversarial-review.md` copies. The [renderer documentation](ai-renderer/README.md) describes candidate checks and tool policy. Sandbox startup still renders before registering `ai-rendered/pi/packages/mzizzi`; production Claude plugins and marketplace loading remain unchanged.

Two things worth knowing when writing markdown here:

- Paragraphs are reflowed, so a line break inside a paragraph is not preserved. Where consecutive lines are meant to stay separate (a list of example sentences inside a blockquote, say), either make them real list items or guard the block with `<!-- prettier-ignore -->` on the line above it.
- Line endings are LF everywhere, pinned by `.gitattributes` rather than by each machine's `core.autocrlf`.

Editors should soft-wrap markdown so the unwrapped files stay readable. VS Code: `"[markdown]": { "editor.wordWrap": "on" }`. IntelliJ: Editor -> General -> Soft Wraps, with `md` in the soft-wrap file mask. Neither is a tracked file, so it is a per-developer step.
