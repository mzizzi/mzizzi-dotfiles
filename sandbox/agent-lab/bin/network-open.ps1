param(
    [ValidateNotNullOrEmpty()]
    [string]$Sandbox = 'agent-lab'
)

$ErrorActionPreference = 'Stop'
sbx policy allow network --sandbox $Sandbox '**'
exit $LASTEXITCODE
