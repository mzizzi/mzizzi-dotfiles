#!/usr/bin/env bash
# sbx clones only the primary workspace, and the workspace's parent is root-owned, so this clones under $HOME.
set -euo pipefail

dest="$HOME/code/SimRacing"
[ -e "$dest/.git" ] || git clone https://github.com/mzizzi/SimRacing.git "$dest"
