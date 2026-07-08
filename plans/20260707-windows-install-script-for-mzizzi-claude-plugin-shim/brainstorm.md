# Windows install script for mzizzi Claude plugin shim — Brainstorm

## The idea

On macOS, the user always loads the `mzizzi` plugin from this repo without installing it via the
Claude Code marketplace, using a shell alias: `alias claude="claude --plugin-dir=<path>"`. Earlier
in this session that equivalent was worked out for Windows (a PowerShell profile function, since
PowerShell aliases can't take arguments) and briefly implemented directly in the user's
`$PROFILE` — then reverted, because the user had only asked *how*, not for it to be done.

The user now wants this turned into a proper, reusable, idempotent install script committed to
the repo (`mzizzi-dotfiles`), so setting up a new Windows machine (or recovering from a wiped
profile) is a single command instead of manual edits. The repo is currently greenfield for this:
no `scripts/`, no README, no existing bootstrap conventions to match — it only has
`plugins/mzizzi/` (the plugin content) and `.claude-plugin/marketplace.json` (the marketplace
manifest for those who *do* want to install it the normal way).

## Decisions

### Which PowerShell profile(s) to configure
- **Question:** Should the installer target only the current host's `$PROFILE`, unconditionally write both Windows PowerShell 5.1 and PowerShell 7 profiles, or conditionally write both based on what's installed?
- **Decision:** Target only `$PROFILE` for whatever host runs the installer.
- **Why:** Confirmed only Windows PowerShell 5.1 is installed on this machine (`pwsh` not found via `Get-Command` or in `Program Files\PowerShell\7`). Writing a profile for an edition that isn't installed is speculative; if PowerShell 7 is installed later, re-running the installer under `pwsh` handles it. Keeps the script simple and matched to actual current state (YAGNI).

### Idempotency mechanism
- **Question:** How should the function get into the profile such that re-running the installer is safe — a marker-delimited block written directly into the profile, a plain string-presence check, or something else?
- **Decision:** The installer creates a small repo-tracked wrapper file, `claude-shim.ps1`, containing the `function claude { ... }` body. The profile itself only gets one idempotent line: `. "<path>\claude-shim.ps1"` (dot-source).
- **Why:** Keeps the actual function logic version-controlled in the repo instead of duplicated inside the user's profile. Future changes to the shim's behavior are just edits to the repo file — no need to re-run the installer or touch the profile again. Idempotency check collapses to "is there a line dot-sourcing this file," which is simpler and more robust than maintaining a marker-delimited block inline.

### Path resolution inside claude-shim.ps1
- **Question:** Should the `--plugin-dir` path be hardcoded as an absolute string (baked in by the installer at run time) or computed dynamically from the shim's own file location?
- **Decision:** Compute it relative to `$PSScriptRoot` at runtime (the plugin dir is the parent of `scripts/windows/`, where the shim lives).
- **Why:** Makes the shim self-correcting if the repo folder is ever moved or renamed, or if someone else runs the same installer after cloning to a different path. Avoids a stale hardcoded path silently breaking after a repo move.

### Script location in the repo
- **Question:** Where should `install.ps1` and `claude-shim.ps1` live — alongside `plugins/mzizzi/`, at the repo root, or in a dedicated top-level location?
- **Decision:** `scripts/windows/install.ps1` and `scripts/windows/claude-shim.ps1`.
- **Why:** Separates OS-specific shell-bootstrap tooling (which Claude Code itself never reads) from `plugins/` (actual plugin content: skills, `.claude-plugin/plugin.json`). Leaves room for a future `scripts/macos/` or `scripts/linux/` sibling without reshuffling. More discoverable than dropping loose files at repo root.

### Detecting "already installed" for idempotent re-runs
- **Question:** Should the installer match on the exact full dot-source line (only skipping if byte-identical), or pattern-match more loosely (e.g. any line referencing `claude-shim.ps1`) and replace it?
- **Decision:** Pattern-match on `claude-shim.ps1` anywhere in the profile; if found, replace that line with the current correct one; otherwise append it.
- **Why:** Self-heals a stale path if the repo is ever re-cloned to a different location — re-running the installer fixes a broken/dead line instead of leaving it in place alongside a second, working line.

### Prerequisite validation
- **Question:** Should `install.ps1` validate prerequisites (the `claude` CLI resolvable on PATH, `plugin.json` present at the expected relative path) before writing anything, or just write files unconditionally?
- **Decision:** Validate first; fail fast with a clear error and exit without modifying anything if either check fails.
- **Why:** Prevents silently installing a shim that will error on every new shell (e.g. if `claude.exe` isn't on PATH yet, or the script was somehow copied out of the repo without the plugin folder alongside it).

### Uninstall support
- **Question:** Should there be a way to cleanly remove the shim/profile line — a separate script, a flag on the same script, or out of scope for now?
- **Decision:** Add a `-Uninstall` switch to `install.ps1` (same script handles both directions).
- **Why:** Keeps install/uninstall logic colocated and reusing the same detection (pattern match) logic, avoiding drift between two files that both need to agree on how the line is found.

### Documentation
- **Question:** The repo has no README at all — should this work add one?
- **Decision:** Yes, add a minimal top-level `README.md` with a short "Windows setup" section: what it does and the one-line invocation.
- **Why:** Without it, the installer is undiscoverable to future-you (or anyone else who clones the repo) short of browsing `scripts/windows/` directly. Per the project's documentation conventions, keep it to purpose + invocation — no flag enumeration (the script's own help/comments are the source of truth for that).

## Open questions

- The `mzizzi` plugin's `plugin.json` declares a cross-marketplace dependency on `codex@openai-codex`. Sideloading `mzizzi` via `--plugin-dir` bypasses normal marketplace dependency resolution — on this machine `codex` is already enabled via the user's global `settings.json` (`enabledPlugins: codex@openai-codex: true`), so it's a non-issue here, but it's unverified whether Claude Code would warn/error about the unresolved dependency on a fresh machine where `codex` isn't separately enabled. Not addressed by this script; worth a quick check during implementation or a follow-up note in the README if it turns out to matter.
