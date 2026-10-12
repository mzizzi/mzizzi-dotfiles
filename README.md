# mzizzi-dotfiles

Personal Claude Code plugin marketplace and dotfiles.

## Plugins

- `plugins/mzizzi` — planning and review workflow skills (grill, brainstorm, create-plan, create-plan-dir, retro). Published via `.claude-plugin/marketplace.json` for anyone installing it the normal way through a Claude Code marketplace.

## Windows setup

`scripts/windows/install.ps1` wires the local `claude` CLI to always load this repo's `plugins/mzizzi` plugin straight from this checkout (via a PowerShell profile function), without installing it from a marketplace -- useful when iterating on the plugin's own skills. Run once from the repo root:

    .\scripts\windows\install.ps1

Safe to re-run any time, including after moving or re-cloning the repo -- it self-heals the profile line instead of duplicating it. See the script itself for other options (including uninstalling).

It also symlinks `~/.claude/CLAUDE.md` -- the user-level instructions Claude Code loads in every project -- to `config/CLAUDE.md` here, so those preferences are version-controlled rather than living only in the home directory. Any file already at that path is kept as `CLAUDE.md.pre-dotfiles`. Windows only permits unprivileged symlink creation with Developer Mode on, so without it the script raises a UAC prompt for that one operation; decline it and the existing file is put back untouched. Only the first run prompts -- afterwards the link is already correct and the step is a no-op.

## Markdown formatting

Markdown here is stored one logical line per paragraph -- editors soft-wrap it, so a one-word edit no longer reshuffles a paragraph's wrap points into a multi-line diff. Prettier does the reflowing and `.prettierrc` is the contract, read by the git hook and by any editor Prettier plugin alike. The hook is authoritative: it pins its own Prettier version, while an editor plugin uses whatever version it ships with, so the two can still disagree on output the pin has changed. If format-on-save keeps producing edits the hook then rewrites, match your editor's Prettier to the version pinned in `.pre-commit-config.yaml`.

Enforcement is a [pre-commit](https://pre-commit.com) hook (`.pre-commit-config.yaml`), which builds its own node environment and installs the pinned Prettier -- there is no `package.json` or `node_modules` in this repo. That is a client-side hook and therefore best-effort: it does not exist on a clone that never ran the steps below, and `git commit --no-verify` skips it. There is no CI check backing it up.

Per machine, once:

    python -m pip install --user pre-commit

Per clone, once, from the repo root:

    python -m pre_commit install

Use `python -m pre_commit ...` rather than the `pre-commit` shim: a `--user` install puts the shim somewhere that is not necessarily on PATH. The generated git hook is unaffected -- it embeds an absolute path to the Python that installed it.

To reformat everything by hand (after changing `.prettierrc`, say):

    python -m pre_commit run --all-files

When a commit genuinely needs to skip the check, prefer `SKIP=prettier git commit` over `--no-verify` -- it stays narrow if more hooks are added later.

Two things worth knowing when writing markdown here:

- Paragraphs are reflowed, so a line break inside a paragraph is not preserved. Where consecutive lines are meant to stay separate (a list of example sentences inside a blockquote, say), either make them real list items or guard the block with `<!-- prettier-ignore -->` on the line above it.
- Line endings are LF everywhere, pinned by `.gitattributes` rather than by each machine's `core.autocrlf`.

Editors should soft-wrap markdown so the unwrapped files stay readable. VS Code: `"[markdown]": { "editor.wordWrap": "on" }`. IntelliJ: Editor -> General -> Soft Wraps, with `md` in the soft-wrap file mask. Neither is a tracked file, so it is a per-developer step.
