param(
    [ValidateNotNullOrEmpty()]
    [string]$Sandbox = 'agent-lab'
)

$ErrorActionPreference = 'Stop'
sbx policy rm network --sandbox $Sandbox --resource '**' --force
exit $LASTEXITCODE
