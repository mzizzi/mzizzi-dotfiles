#!/usr/bin/env bash
# Creates the agent-lab sandbox if missing and attaches a terminal to it.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
exec sbx env run sandbox "$@"
