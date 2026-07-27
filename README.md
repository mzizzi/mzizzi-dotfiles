# mzizzi-dotfiles

Personal Claude Code plugin marketplace and dotfiles.

## Plugins

- `plugins/mzizzi` — planning and review workflow skills (grill, brainstorm, create-plan, create-plan-dir, retro). Published via `.claude-plugin/marketplace.json` for anyone installing it the normal way through a Claude Code marketplace.

## Windows setup

`scripts/windows/install.ps1` wires the local `claude` CLI to always load this repo's `plugins/mzizzi` plugin straight from this checkout (via a PowerShell profile function), without installing it from a marketplace -- useful when iterating on the plugin's own skills. Run once from the repo root:

    .\scripts\windows\install.ps1

Safe to re-run any time, including after moving or re-cloning the repo -- it self-heals the profile line instead of duplicating it. See the script itself for other options (including uninstalling).
