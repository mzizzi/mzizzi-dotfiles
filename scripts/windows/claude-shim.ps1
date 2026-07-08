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
