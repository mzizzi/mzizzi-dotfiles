<#
.SYNOPSIS
    Wires the local claude CLI to always load this repo's plugins/mzizzi
    plugin via --plugin-dir, without installing it from a Claude Code
    marketplace, and links ~/.claude/CLAUDE.md to this repo's
    config/CLAUDE.md. Safe to re-run any time.
.EXAMPLE
    .\install.ps1
.EXAMPLE
    .\install.ps1 -Uninstall
#>
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

$CodexMarketplaceName   = 'openai-codex'
$CodexMarketplaceSource = 'openai/codex-plugin-cc'
$CodexPluginId          = 'codex@openai-codex'

$GlobalClaudeMdSource = Join-Path $RepoRoot 'config\CLAUDE.md'
$GlobalClaudeMdLink   = Join-Path $env:USERPROFILE '.claude\CLAUDE.md'

function Fail([string]$Message) {
    Write-Error $Message
    exit 1
}

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

function Ensure-CodexDependency {
    # Best-effort, not fail-fast: mzizzi's own skills work via --plugin-dir
    # regardless of whether this optional dependency resolves, so a network
    # hiccup fetching it shouldn't block the core install.
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

function Get-LinkTarget([string]$Path) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType -eq 'SymbolicLink') { return $item.Target }
    return $null
}

function New-GlobalClaudeMdLink {
    # Unprivileged symlink creation only works with Developer Mode on, so try it
    # directly and fall back to asking for elevation for this one operation --
    # cheaper for the user than changing a system-wide setting by hand.
    try {
        New-Item -ItemType SymbolicLink -Path $GlobalClaudeMdLink -Target $GlobalClaudeMdSource -ErrorAction Stop | Out-Null
        return $true
    } catch {
        Write-Host "Creating the symlink needs elevation -- accept the UAC prompt to link it."
    }

    $command = "New-Item -ItemType SymbolicLink -Path '{0}' -Target '{1}' -Force | Out-Null" -f $GlobalClaudeMdLink, $GlobalClaudeMdSource
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -WindowStyle Hidden `
            -ArgumentList '-NoProfile', '-Command', $command -ErrorAction Stop
    } catch {
        return $false
    }

    return [bool](Get-LinkTarget $GlobalClaudeMdLink)
}

function Install-GlobalClaudeMd {
    $target = Get-LinkTarget $GlobalClaudeMdLink
    if ($target -and ([System.IO.Path]::GetFullPath($target) -eq $GlobalClaudeMdSource)) {
        Write-Host "~/.claude/CLAUDE.md already points at config\CLAUDE.md."
        return
    }

    $linkDir = Split-Path -Parent $GlobalClaudeMdLink
    if (-not (Test-Path -LiteralPath $linkDir)) {
        New-Item -ItemType Directory -Path $linkDir -Force | Out-Null
    }

    # Whatever is there now is either a stale link or the user's own file. Move it
    # aside rather than overwriting: the file being replaced is hand-written config
    # with no other copy.
    $backup = $null
    if (Test-Path -LiteralPath $GlobalClaudeMdLink) {
        $backup = '{0}.pre-dotfiles' -f $GlobalClaudeMdLink
        Move-Item -LiteralPath $GlobalClaudeMdLink -Destination $backup -Force
    }

    if (New-GlobalClaudeMdLink) {
        Write-Host "Linked ~/.claude/CLAUDE.md -> $GlobalClaudeMdSource"
        if ($backup) { Write-Host "The file that was there is kept at $backup" }
        return
    }

    # Declining the UAC prompt must not cost the user their global instructions.
    if ($backup) {
        Move-Item -LiteralPath $backup -Destination $GlobalClaudeMdLink -Force
    }
    Write-Warning "Could not create the ~/.claude/CLAUDE.md symlink; the existing file was left as-is. Enable Developer Mode (Settings > System > For developers) or re-run this script from an elevated PowerShell."
}

if ($Uninstall) {
    $existingLines  = Get-ProfileLines
    $remainingLines = @($existingLines | Where-Object { $_ -notmatch $ShimPattern })

    if ($remainingLines.Count -ne $existingLines.Count) {
        Set-ProfileLines $remainingLines
        Write-Host "Removed the claude-shim.ps1 line from $PROFILE"
    } else {
        Write-Host "No claude-shim.ps1 line found in $PROFILE (nothing to remove)"
    }

    $linkTarget = Get-LinkTarget $GlobalClaudeMdLink
    if ($linkTarget -and ([System.IO.Path]::GetFullPath($linkTarget) -eq $GlobalClaudeMdSource)) {
        Remove-Item -LiteralPath $GlobalClaudeMdLink -Force
        Write-Host "Removed the ~/.claude/CLAUDE.md symlink (config\CLAUDE.md itself is a tracked repo file and stays)."
    }

    Write-Host "Uninstall complete. Open a new PowerShell window for the change to take effect."
    Write-Host "(scripts/windows/claude-shim.ps1 was left in place -- it's a tracked repo file, not an install artifact.)"
    exit 0
}

# --- Install ---

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
if (-not (Test-Path -LiteralPath $GlobalClaudeMdSource)) {
    Fail "config\CLAUDE.md not found at '$GlobalClaudeMdSource'. The repo checkout may be incomplete."
}

Ensure-CodexDependency
Install-GlobalClaudeMd

$existingLines  = Get-ProfileLines
$remainingLines = @($existingLines | Where-Object { $_ -notmatch $ShimPattern })
$newLines       = $remainingLines + $DotSourceLine

Set-ProfileLines $newLines

Write-Host "claude now always loads plugins/mzizzi via --plugin-dir."
Write-Host "Profile updated: $PROFILE"
Write-Host "Open a new PowerShell window (or run '. `$PROFILE') for the change to take effect."
exit 0
