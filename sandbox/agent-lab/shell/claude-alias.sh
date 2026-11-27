# shellcheck shell=bash
# Sourced from ~/.bashrc: makes `claude` load this checkout's rendered mzizzi plugin, the
# sandbox equivalent of scripts/windows/claude-shim.ps1.
if [ -d "${WORKSPACE_DIR-}/ai-rendered/claude/plugins/mzizzi" ]; then
    alias claude='claude --plugin-dir "$WORKSPACE_DIR/ai-rendered/claude/plugins/mzizzi"'
fi
