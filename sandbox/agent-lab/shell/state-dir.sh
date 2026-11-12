# shellcheck shell=bash
# Sourced from ~/.bashrc, not executed: it sets history variables and exports into the
# interactive shell.
#
# Keeps Bash history, Claude, dcode and pi sessions on the host when
# %USERPROFILE%\.sandbox-state\agent-lab is passed as an extra workspace; sbx mounts it at
# the host-mirrored path. Without the mount, the defaults apply.
# Tests set AGENT_LAB_MOUNT_ROOT to search a fake filesystem root instead of /.

for state_dir in "${AGENT_LAB_MOUNT_ROOT-}"/*/Users/*/.sandbox-state/agent-lab; do
    if [ -d "$state_dir" ]; then
        mkdir -p "$state_dir/bash" "$state_dir/claude" "$state_dir/deepagents"
        HISTFILE="$state_dir/bash/history"
        # Unlimited, so bash does not trim the persisted file on exit.
        HISTSIZE=-1
        HISTFILESIZE=-1

        export CLAUDE_CONFIG_DIR="$state_dir/claude"
        # Copy the kit's placeholder login, which the credential proxy swaps for the host login, into
        # Claude's config dir. A copy because the Windows-backed mount refuses symlinks.
        cp -f "$HOME/.claude/.credentials.json" "$CLAUDE_CONFIG_DIR/.credentials.json"

        # Only dcode's thread database moves; the kit's dcode files stay in place.
        # dcode fails to create this database on the mount, so start from an empty one.
        db="$state_dir/deepagents/sessions.db"
        [ -e "$db" ] || python3 -c 'import sqlite3, sys; sqlite3.connect(sys.argv[1]).execute("PRAGMA journal_mode=WAL")' "$db"
        ln -sfn "$db" "$HOME/.deepagents/.state/sessions.db"

        # Only pi's sessions move; the kit manages the rest of its agent dir.
        # A symlink rather than PI_CODING_AGENT_SESSION_DIR, which drops pi's per-directory
        # session layout and the sessions path pi-subagents trusts.
        pi_dir="$HOME/.pi/agent"
        mkdir -p "$state_dir/pi/sessions"
        # A real sessions dir means pi ran before this script; keep what it wrote.
        if [ -d "$pi_dir/sessions" ] && [ ! -L "$pi_dir/sessions" ]; then
            cp -a "$pi_dir/sessions/." "$state_dir/pi/sessions/" && rm -rf "$pi_dir/sessions"
        fi
        ln -sfn "$state_dir/pi/sessions" "$pi_dir/sessions"
    fi
done
unset state_dir db pi_dir
shopt -s histappend
PROMPT_COMMAND="history -a${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
