# Windows install script for the mzizzi Claude plugin shim

## Context

This repo (`mzizzi-dotfiles`) is the user's personal Claude Code plugin marketplace and dotfiles repo. On macOS, the user always loads its `plugins/mzizzi` plugin without a marketplace install, via a shell alias: `alias claude="claude --plugin-dir=<path>"`. Earlier in this session the Windows equivalent was worked out (a PowerShell profile *function*, since PowerShell aliases can't carry arguments) and briefly hand-applied to `$PROFILE`, then reverted since only the "how" had been asked, not the doing. A subsequent brainstorm (`plans/20260707-windows-install-script-for-mzizzi-claude-plugin-shim/brainstorm.md`) turned this into a proper, reusable, idempotent install script so setting up a new Windows machine (or recovering from a wiped profile) is one command.

The repo is greenfield for this: no `scripts/`, no README, no bootstrap tooling of any kind exists yet. The eight design decisions from the brainstorm (profile scope, idempotency mechanism, path resolution, file layout, detection/self-healing, prerequisite validation, uninstall support, documentation) are treated as settled constraints below, not re-derived — with two exceptions surfaced after the brainstorm: the uninstall decision was revised following Codex adversarial review (see "Ownership split" below), and a ninth concern — the brainstorm's one open question about the plugin's `codex@openai-codex` dependency — was resolved during plan review by adding an idempotent dependency-install step (see "Ensuring the `codex@openai-codex` dependency is satisfied" below) rather than left as a documented limitation.

## Design

### Relative path math: `scripts/windows/` → `plugins/mzizzi/`

Both new scripts live at `scripts/windows/<file>.ps1`. From that directory, the repo root is **two** levels up (`scripts/windows` → `scripts` → repo root), and `plugins/mzizzi` hangs off the root:

```
<repo-root>\scripts\windows\claude-shim.ps1     <-- $PSScriptRoot = <repo-root>\scripts\windows
<repo-root>\plugins\mzizzi\.claude-plugin\plugin.json
```

Relative path from the shim's own directory to the plugin dir: **`..\..\plugins\mzizzi`**. Both `claude-shim.ps1` (at load time) and `install.ps1` (at validation/wiring time) derive this from their own `$PSScriptRoot`, never from a hardcoded absolute string.

### Ownership split: what `install.ps1` writes vs. what's static

`claude-shim.ps1`'s **content** is authored once as a normal repo file (implemented and committed alongside `install.ps1`, a static version-controlled script). `install.ps1` does **not** regenerate its body on every run — per the brainstorm's own framing, "future changes to the shim's behavior are just edits to the repo file." `install.ps1`'s only two jobs are:

1. Validate prerequisites.
2. Ensure `$PROFILE` has exactly one correct dot-source line pointing at `claude-shim.ps1`'s current absolute path.

**Revision from the brainstorm, based on Codex adversarial review:** the brainstorm's decision 7 originally had `-Uninstall` also delete `claude-shim.ps1` from disk. Codex flagged this as a high-severity correctness problem: `claude-shim.ps1` is a normal git-tracked repo file, and `install.ps1`'s own prerequisite validation requires that file to exist before it will wire up the profile. Deleting it on uninstall means a subsequent re-install fails validation until the user manually runs `git checkout -- scripts/windows/claude-shim.ps1` first — a broken re-entrancy/rollback path for a script whose whole purpose is repeatable setup/recovery. `-Uninstall` therefore only removes the profile's dot-source line; it never touches `claude-shim.ps1` on disk. The file stays in place (and in git) whether installed or not — "uninstalled" just means nothing dot-sources it anymore.

### `install.ps1` algorithm

```
if -Uninstall:
    read $PROFILE lines (or empty if it doesn't exist)
    remove any line matching the claude-shim.ps1 pattern
    write back only if something was removed
    print summary, exit 0
    (claude-shim.ps1 itself is never touched — it's a tracked repo file,
     not an install artifact; leaving it in place means a subsequent
     install.ps1 run doesn't need a git checkout first)
    (no prerequisite validation — uninstall must work even if claude.exe
     or plugins/mzizzi no longer exist, e.g. after the repo was moved)
    (codex@openai-codex is never touched by uninstall either — see below)

else (install):
    validate claude.exe resolves via Get-Command -> else print error, exit 1
    validate plugins/mzizzi/.claude-plugin/plugin.json exists -> else print error, exit 1
    validate claude-shim.ps1 exists next to install.ps1 -> else print error, exit 1
    (no writes have happened yet at this point — fail-fast, no partial state)

    ensure the codex@openai-codex marketplace dependency is satisfied (best-effort, see below)

    read $PROFILE lines (or empty if it doesn't exist)
    filter out any line matching the claude-shim.ps1 pattern (self-heals stale/duplicate lines)
    append exactly one canonical dot-source line
    ensure $PROFILE's parent dir + file exist (New-Item -Force as needed)
    write lines back with Set-Content -Encoding UTF8
    print confirmation + "open a new shell" note, exit 0
```

The "remove all matches, then append exactly one canonical line" approach is a deliberate concretization of decision 5 ("pattern-match... if found, replace that line"): rather than replacing in place at the original line index, it strips every matching line first and appends one fresh line at the end. This guarantees a second run produces a byte-identical file (true idempotency) and self-heals even a double-stale state (e.g. two dead lines from prior manual edits) in one pass, at the cost of not preserving the line's original position in the profile — irrelevant here since the line is a self-contained dot-source with no ordering dependency on the rest of the profile.

### Ensuring the `codex@openai-codex` dependency is satisfied

`plugins/mzizzi/.claude-plugin/plugin.json` declares a dependency on `codex@openai-codex`. Sideloading `mzizzi` via `--plugin-dir` bypasses normal marketplace dependency resolution, so nothing would otherwise install `codex` on a machine that doesn't already have it. Rather than leaving this as an unverified edge case, `install.ps1` idempotently ensures the dependency is actually installed and enabled, using `claude`'s own plugin-management subcommands (confirmed via `claude plugin --help` and by running each of these read-only commands directly in this session):

- `claude plugin marketplace list --json` — lists configured marketplaces (`name`, `source`, `repo`, `installLocation`); no network call, reads local config.
- `claude plugin marketplace add <source>` — adds a marketplace from a GitHub repo shorthand (e.g. `openai/codex-plugin-cc`), URL, or path.
- `claude plugin list --json` — lists installed plugins (`id` as `<plugin>@<marketplace>`, `enabled`, `installPath`, etc.); no network call.
- `claude plugin install <plugin>@<marketplace>` — installs a plugin from an already-configured marketplace.
- `claude plugin enable <plugin>` — re-enables a plugin that's installed but currently disabled.

The check-then-act sequence, run once during install (not during `-Uninstall`). It distinguishes "not installed at all" (needs `plugin install`) from "installed but disabled" (needs `plugin enable`, not a redundant re-install) — the two are different states in `claude plugin list --json`'s `enabled` field:

```powershell
$CodexMarketplaceName   = 'openai-codex'
$CodexMarketplaceSource = 'openai/codex-plugin-cc'
$CodexPluginId          = 'codex@openai-codex'

function Ensure-CodexDependency {
    try {
        $marketplaces = claude plugin marketplace list --json | ConvertFrom-Json
        $hasMarketplace = $marketplaces | Where-Object { $_.name -eq $CodexMarketplaceName }
        if (-not $hasMarketplace) {
            Write-Host "Adding marketplace '$CodexMarketplaceName' (dependency of the mzizzi plugin)..."
            claude plugin marketplace add $CodexMarketplaceSource | Out-Null
        }

        $installed = claude plugin list --json | ConvertFrom-Json
        $existing = $installed | Where-Object { $_.id -eq $CodexPluginId }
        if (-not $existing) {
            Write-Host "Installing '$CodexPluginId' (dependency of the mzizzi plugin)..."
            claude plugin install $CodexPluginId | Out-Null
        } elseif (-not $existing.enabled) {
            Write-Host "Enabling '$CodexPluginId' (dependency of the mzizzi plugin)..."
            claude plugin enable $CodexPluginId | Out-Null
        }
    } catch {
        Write-Warning "Could not verify/install the codex@openai-codex dependency automatically ($_). The mzizzi plugin's codex-dependent skills may not work until this is resolved manually: claude plugin marketplace add $CodexMarketplaceSource; claude plugin install $CodexPluginId"
    }
}
```

This is deliberately **best-effort, not fail-fast**: a failure here (offline machine, GitHub unreachable, marketplace add rejected) prints a warning and lets `install.ps1` continue to wire up the profile — the mzizzi plugin's own skills (grill, brainstorm, create-plan, etc.) work via `--plugin-dir` regardless of whether the codex dependency resolved, so a network hiccup fetching an optional dependency shouldn't block the core install. Contrast with the prerequisite validation above (missing `claude.exe` or a missing `plugin.json`), which *is* fail-fast because those indicate the install itself is broken, not an optional dependency being unavailable.

Re-running `install.ps1` re-checks both conditions and is a no-op if already satisfied — consistent with the rest of the script's idempotency.

### Pattern-match regex

A single constant, reused by both branches:

```powershell
$ShimFileName = 'claude-shim.ps1'
$ShimPattern  = [regex]::Escape($ShimFileName)   # 'claude-shim\.ps1'
...
$remainingLines = @($existingLines | Where-Object { $_ -notmatch $ShimPattern })
```

`[regex]::Escape` guards the literal dot in the filename so it doesn't act as a regex wildcard. This matches decision 5's "substring/regex match, not exact full-line equality" — it will match a dot-source line at any past absolute path, a manually-authored line, or even a comment mentioning the filename, and replace/remove all of them uniformly.

### PowerShell code sketches

**Prerequisite validation and fail-fast (no `$ErrorActionPreference = 'Stop'`):**

Do **not** set `$ErrorActionPreference = 'Stop'` globally. `Write-Error` is non-terminating by default; pairing it with an explicit `exit 1` on the next line gives predictable control flow. If `$ErrorActionPreference` were forced to `'Stop'`, `Write-Error` would throw and abort the script *before* reaching the following `exit 1`, which is a common footgun in install-script patterns — worth avoiding here.

```powershell
[CmdletBinding()]
param(
    [switch]$Uninstall
)

$ScriptDir      = $PSScriptRoot
$RepoRoot       = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir '..\..'))
$PluginDir      = Join-Path $RepoRoot 'plugins\mzizzi'
$PluginManifest = Join-Path $PluginDir '.claude-plugin\plugin.json'
$ShimPath       = Join-Path $ScriptDir 'claude-shim.ps1'
$ShimPattern    = [regex]::Escape('claude-shim.ps1')
$DotSourceLine  = '. "{0}"' -f $ShimPath

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}
```

`[System.IO.Path]::GetFullPath` (rather than `Resolve-Path`) is used deliberately: `Resolve-Path` throws its own generic terminating error if the target doesn't exist, which would bypass the script's own clear `Fail` messaging. `GetFullPath` normalizes `..` segments without requiring the path to exist, letting the explicit `Test-Path` checks below produce the intended custom error text.

```powershell
if (-not $Uninstall) {
    $claudeCommand = Get-Command claude.exe -ErrorAction SilentlyContinue
    if (-not $claudeCommand) {
        Fail "claude.exe was not found on PATH. Install the Claude Code CLI first, then re-run this script."
    }
    if (-not (Test-Path -LiteralPath $PluginManifest)) {
        Fail "Expected plugin manifest not found at '$PluginManifest'. Is this script still inside the mzizzi-dotfiles repo at scripts/windows/?"
    }
    if (-not (Test-Path -LiteralPath $ShimPath)) {
        Fail "claude-shim.ps1 not found at '$ShimPath'. The repo checkout may be incomplete."
    }
}
```

**Reading/writing profile lines** — read as a line array (not `-Raw`) so CRLF/LF splitting is handled transparently by `Get-Content`, and write back with an explicit encoding to avoid Windows PowerShell 5.1's non-UTF8 default `Set-Content` encoding mangling any non-ASCII characters that might already be in the profile (accented names, smart quotes, emoji from prompt-theme comments, etc.):

```powershell
function Get-ProfileLines {
    if (Test-Path -LiteralPath $PROFILE) {
        return @(Get-Content -LiteralPath $PROFILE)
    }
    return @()
}

function Set-ProfileLines([string[]]$Lines) {
    $profileDir = Split-Path -Parent $PROFILE
    if (-not (Test-Path -LiteralPath $profileDir)) {
        New-Item -ItemType Directory -Path $profileDir -Force | Out-Null
    }
    if (-not (Test-Path -LiteralPath $PROFILE)) {
        New-Item -ItemType File -Path $PROFILE -Force | Out-Null
    }
    Set-Content -LiteralPath $PROFILE -Value $Lines -Encoding UTF8
}
```

Gotcha to note in review: `-Encoding UTF8` in Windows PowerShell 5.1 writes UTF-8 **with a BOM** (unlike PowerShell 7's UTF8-no-BOM default). That's harmless here — both Windows PowerShell and `pwsh` parse a BOM'd UTF-8 profile script correctly — but worth knowing if the file is later diffed byte-for-byte. `Test-Path $PROFILE` returned `False` on this machine (profile doesn't exist yet), so the `New-Item -Force` path is a real, exercised code path, not just defensive dead code.

**Uninstall branch:**

```powershell
if ($Uninstall) {
    $existingLines  = Get-ProfileLines
    $remainingLines = @($existingLines | Where-Object { $_ -notmatch $ShimPattern })

    if ($remainingLines.Count -ne $existingLines.Count) {
        Set-ProfileLines $remainingLines
        Write-Host "Removed the claude-shim.ps1 line from $PROFILE"
    } else {
        Write-Host "No claude-shim.ps1 line found in $PROFILE (nothing to remove)"
    }

    Write-Host "Uninstall complete. Open a new PowerShell window for the change to take effect."
    Write-Host "(scripts/windows/claude-shim.ps1 was left in place -- it's a tracked repo file, not an install artifact.)"
    exit 0
}
```

**Install branch (after validation above):**

```powershell
$existingLines  = Get-ProfileLines
$remainingLines = @($existingLines | Where-Object { $_ -notmatch $ShimPattern })
$newLines       = $remainingLines + $DotSourceLine

Set-ProfileLines $newLines

Write-Host "claude now always loads plugins/mzizzi via --plugin-dir."
Write-Host "Profile updated: $PROFILE"
Write-Host "Open a new PowerShell window (or run '. `$PROFILE') for the change to take effect."
exit 0
```

### Line-ending / `.gitattributes` note

No `.gitattributes` exists in the repo. `git config --global --get core.autocrlf` is `true` on this machine (not set at the repo-local level), so checkouts already get CRLF line endings automatically for this user. Since PowerShell (both 5.1 and 7) parses `.ps1` files correctly with either LF or CRLF, no `.gitattributes` entry is functionally required for this feature to work on any clone. Adding `scripts/windows/*.ps1 text eol=crlf` would only be cosmetic consistency-polish across machines with different `core.autocrlf` settings — worth a one-line follow-up if it ever becomes visibly inconsistent, but out of scope for this change.

### Repo conventions checked

- `.claude/rules/shell.md` ("Prefer the Bash tool over PowerShell for running shell commands") governs which tool *the agent* uses to run shell commands during a session — it does not constrain the scripting language of a Windows-only install script the user explicitly asked to be PowerShell. No conflict.
- `.claude/rules/documentation.md` says don't enumerate CLI flags/config schema in docs; reference by path instead. The README section below follows this — no flag list, just purpose + one example invocation, with "see the script itself" for the rest (including `-Uninstall`).

## Implementation

Create these three files, in this order:

### 1. `scripts/windows/claude-shim.ps1`

Static, version-controlled script. Computes the plugin directory from its own location and defines the `claude` function:

```powershell
# scripts/windows/claude-shim.ps1
#
# Dot-sourced from $PROFILE (wired up by scripts/windows/install.ps1) so every
# new PowerShell session gets a `claude` function that always loads this
# repo's plugins/mzizzi plugin via --plugin-dir, without installing it from a
# Claude Code marketplace. Windows equivalent of the macOS
# `alias claude="claude --plugin-dir=<path>"` setup -- a function instead of
# an alias because PowerShell aliases can't carry arguments.
#
# The plugin directory is computed from this file's own location
# ($PSScriptRoot) at load time, not hardcoded, so it keeps working if the
# repo is ever moved or re-cloned elsewhere. (Re-run install.ps1 after a move
# so $PROFILE's dot-source line points at this file's new absolute path.)

$MzizziPluginDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\plugins\mzizzi'))

function claude {
    # Must call claude.exe (with the extension), not the bare `claude` name:
    # since this function is itself named `claude`, calling the bare name
    # from inside its own body would recurse into itself instead of
    # resolving to the real CLI. PowerShell resolves the exact-name match
    # `claude.exe` to the external binary, sidestepping the recursion.
    claude.exe --plugin-dir $MzizziPluginDir @args
}
```

### 2. `scripts/windows/install.ps1`

The full algorithm from the Design section above, assembled into one script with comment-based help (`.SYNOPSIS`/`.EXAMPLE`) at the top and the `[switch]$Uninstall` param. Integration point: `install.ps1` never hardcodes an absolute plugin path — it only computes `$ShimPath` (the absolute path to its sibling `claude-shim.ps1`, from its own `$PSScriptRoot`) and writes that path into `$PROFILE`'s dot-source line. `claude-shim.ps1` in turn computes the plugin dir dynamically at load time from its own `$PSScriptRoot`. This is the intentional two-stage indirection: install-time absolute path (repo location) vs. load-time relative path (plugin dir within repo), matching the brainstorm's "self-correcting if the repo is moved" rationale — a move only requires re-running `install.ps1` (to fix the profile's pointer to the shim), not any edit to the shim itself.

Also includes the `Ensure-CodexDependency` function from the Design section, called once during the install branch (not during `-Uninstall`) after prerequisite validation passes and before the profile is patched.

### 3. `README.md`

New top-level file. Minimal, per `.claude/rules/documentation.md` (no flag enumeration):

```markdown
# mzizzi-dotfiles

Personal Claude Code plugin marketplace and dotfiles.

## Plugins

- `plugins/mzizzi` — planning and review workflow skills (grill, brainstorm,
  create-plan, create-plan-dir, retro). Published via
  `.claude-plugin/marketplace.json` for anyone installing it the normal way
  through a Claude Code marketplace.

## Windows setup

`scripts/windows/install.ps1` wires the local `claude` CLI to always load
this repo's `plugins/mzizzi` plugin straight from this checkout (via a
PowerShell profile function), without installing it from a marketplace --
useful when iterating on the plugin's own skills. Run once from the repo
root:

    .\scripts\windows\install.ps1

Safe to re-run any time, including after moving or re-cloning the repo -- it
self-heals the profile line instead of duplicating it. See the script itself
for other options (including uninstalling).
```

## Testing

No fresh Windows machine is available, so verification is manual, on the current machine:

- **Install runs and profile is updated**: run `.\scripts\windows\install.ps1`; confirm exit code `0` and the printed confirmation. Inspect `$PROFILE` content (`Get-Content $PROFILE`) — should contain exactly one line: `. "<repo>\scripts\windows\claude-shim.ps1"`.
- **Function loads in a new shell**: open a new PowerShell window (or run `powershell -NoProfile -Command ". $PROFILE; Get-Command claude"` for a scoped check) and confirm `Get-Command claude` reports `CommandType: Function`, not `Application`. `(Get-Command claude).ScriptBlock` (or `Get-Content Function:\claude`) should show the literal `claude.exe --plugin-dir $MzizziPluginDir @args` body with `$MzizziPluginDir` resolved to the correct absolute `plugins\mzizzi` path (`$MzizziPluginDir` itself can be echoed in the same scoped session for a direct check).
- **`--plugin-dir` actually took effect**: in an interactive `claude` session started via the new function, check that `plugins/mzizzi`'s skills (e.g. `/create-plan`, `/grill`) are available even though the plugin isn't installed via any marketplace/`enabledPlugins` entry — that's the practical end-to-end signal the flag is being honored, since those skills only exist in this checkout.
- **Idempotency**: run `install.ps1` a second time immediately after the first; diff `$PROFILE` before/after the second run (e.g. capture `Get-Content $PROFILE` to a variable before, again after, compare) — should be byte-identical.
- **Self-healing after a "moved repo" scenario**: manually edit the `$PROFILE` line to point at a bogus path (e.g. a nonexistent drive/folder), then re-run `install.ps1`; confirm the profile again contains exactly one line, now pointing at the correct current `claude-shim.ps1` path (no leftover stale line, no duplicate).
- **Uninstall**: run `.\scripts\windows\install.ps1 -Uninstall`; confirm the dot-source line is gone from `$PROFILE`, that a new shell's `Get-Command claude` resolves back to `Application` (the raw `claude.exe`), and that `scripts\windows\claude-shim.ps1` is still present on disk with `git status` reporting no changes to it (uninstall must not touch the tracked file at all). Then immediately re-run `.\scripts\windows\install.ps1` with no flags and confirm it succeeds without any manual `git checkout` step — this is the reinstall/recovery path the script exists for, and it must work right after an uninstall.
- **Validation failure paths**: temporarily rename `plugins\mzizzi\.claude-plugin\plugin.json` (or simulate `claude.exe` missing by testing in a shell with a scrubbed `PATH`) and confirm `install.ps1` prints a clear error, exits non-zero, and leaves `$PROFILE` untouched.
- **Codex dependency check is idempotent**: on this machine `codex@openai-codex` is already installed and enabled, so a normal run should log nothing new for that step (or a clearly-worded "already satisfied" style message, if the implementation chooses to log the no-op case) and not attempt `marketplace add`/`plugin install` again. To exercise the "not yet installed" path without disturbing this machine's real global config, either: temporarily `claude plugin disable codex@openai-codex` (a supported, reversible CLI action — re-enable with `claude plugin enable codex@openai-codex` afterward) and confirm `install.ps1` re-enables/installs it, or review the logic by inspection since `claude plugin marketplace list --json` / `claude plugin list --json` output shapes are already confirmed above.
- **Codex dependency check degrades gracefully**: simulate a failure (e.g. temporarily rename/break network access, or point `$CodexMarketplaceSource` at a bogus repo in a scratch copy of the script) and confirm `install.ps1` prints a warning but still completes the profile wiring and exits `0` — the dependency check must never block the core install.
