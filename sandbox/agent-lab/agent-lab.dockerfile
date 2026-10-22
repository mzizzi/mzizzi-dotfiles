FROM docker.io/docker/sandbox-templates:shell-docker@sha256:1560168ac5fb9ce23d413c878349334c5845c07e264cd675d7867f0c78ad1761

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends fd-find ripgrep \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

USER agent
ARG CLAUDE_VERSION
ARG CODEX_VERSION
ARG PI_VERSION
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_VERSION}" "@openai/codex@${CODEX_VERSION}" \
    && npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
    && claude --version \
    && codex --version \
    && pi --version

ARG DCODE_VERSION
# Matches the official installer: a stable release may pin a pre-release
# dependency, and the system Python is too new for prebuilt wheels of some
# dependencies (the image has no C compiler).
RUN uv tool install --no-cache --python 3.13 --prerelease allow "deepagents-code==${DCODE_VERSION}" \
    && dcode --version

RUN mkdir -p /home/agent/.claude /home/agent/.codex /home/agent/.pi/agent /home/agent/.deepagents/.state

# Keep Bash history and Claude and dcode sessions on the host when
# %USERPROFILE%\.sandbox-state\agent-lab is passed as an extra workspace; sbx
# mounts it at the host-mirrored path. Without the mount, the defaults apply.
RUN cat >> /home/agent/.bashrc <<'EOF'

for state_dir in /*/Users/*/.sandbox-state/agent-lab; do
    if [ -d "$state_dir" ]; then
        mkdir -p "$state_dir/bash" "$state_dir/claude" "$state_dir/deepagents"
        HISTFILE="$state_dir/bash/history"
        # Unlimited, so bash does not trim the persisted file on exit.
        HISTSIZE=-1
        HISTFILESIZE=-1

        export CLAUDE_CONFIG_DIR="$state_dir/claude"

        # Only dcode's thread database moves; the kit's dcode files stay in place.
        # dcode fails to create this database on the mount, so start from an empty one.
        db="$state_dir/deepagents/sessions.db"
        [ -e "$db" ] || python3 -c 'import sqlite3, sys; sqlite3.connect(sys.argv[1]).execute("PRAGMA journal_mode=WAL")' "$db"
        ln -sfn "$db" /home/agent/.deepagents/.state/sessions.db
    fi
done
unset state_dir db
shopt -s histappend
PROMPT_COMMAND="history -a${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
EOF

ENV IS_SANDBOX=1 \
    DISABLE_AUTOUPDATER=1

WORKDIR /home/agent/workspace
ENTRYPOINT ["bash"]
CMD ["-l"]
