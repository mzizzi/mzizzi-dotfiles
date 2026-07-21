#!/usr/bin/env bash
# Set up local development for the mzizzi plugin: ensure this repo is cloned
# to ~/code/mzizzi-dotfiles with personal git identity/auth configured.
# Idempotent: safe to re-run. Pair with:
#   claude --plugin-dir ~/code/mzizzi-dotfiles/plugins/mzizzi
set -euo pipefail

REPO_DIR="$HOME/code/mzizzi-dotfiles"
REPO_URL="git@github.com:mzizzi/mzizzi-dotfiles.git"
SSH_KEY="$HOME/.ssh/id_ed25519_personal"
SSH_CMD="ssh -i $SSH_KEY -o IdentitiesOnly=yes"
GIT_EMAIL="mhzizzi@gmail.com"

if [ ! -f "$SSH_KEY" ]; then
  echo "error: personal SSH key not found at $SSH_KEY" >&2
  exit 1
fi

if [ -d "$REPO_DIR/.git" ]; then
  origin_url="$(git -C "$REPO_DIR" remote get-url origin)"
  if [ "$origin_url" != "$REPO_URL" ]; then
    echo "error: $REPO_DIR exists but origin is '$origin_url' (expected '$REPO_URL')" >&2
    exit 1
  fi
  echo "Repo already cloned at $REPO_DIR"
else
  mkdir -p "$(dirname "$REPO_DIR")"
  echo "Cloning $REPO_URL to $REPO_DIR..."
  GIT_SSH_COMMAND="$SSH_CMD" git clone "$REPO_URL" "$REPO_DIR"
fi

# Repo-local settings: personal SSH key and email for this repo only.
git -C "$REPO_DIR" config core.sshCommand "$SSH_CMD"
git -C "$REPO_DIR" config user.email "$GIT_EMAIL"

echo "Done. Add this alias to your shell profile (e.g. ~/.zshrc) so claude"
echo "always loads the plugin from your working tree:"
echo
echo "  alias claude='claude --plugin-dir $REPO_DIR/plugins/mzizzi'"
