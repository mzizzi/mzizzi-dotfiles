#!/usr/bin/env bash
# Opens the agent-lab sandbox workspace in IntelliJ; see sandbox/agent-lab/bin/open-intellij.py.
set -euo pipefail
exec python "$(dirname -- "${BASH_SOURCE[0]}")/../sandbox/agent-lab/bin/open-intellij.py" "$@"
