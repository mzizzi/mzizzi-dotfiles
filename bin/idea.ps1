# Opens the agent-lab sandbox workspace in IntelliJ; see sandbox/agent-lab/bin/open-intellij.py.
& python (Join-Path $PSScriptRoot '..\sandbox\agent-lab\bin\open-intellij.py') @args
exit $LASTEXITCODE
