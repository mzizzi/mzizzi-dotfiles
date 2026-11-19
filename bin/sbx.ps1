# Creates the agent-lab sandbox if missing and attaches a terminal to it.
# sbx.exe, not sbx, so this script cannot call itself when bin/ is on PATH.
& sbx.exe env run (Join-Path $PSScriptRoot '..\sandbox') @args
exit $LASTEXITCODE
