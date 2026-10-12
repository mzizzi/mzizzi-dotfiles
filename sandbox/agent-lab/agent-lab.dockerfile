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

RUN mkdir -p /home/agent/.claude /home/agent/.codex /home/agent/.pi/agent
ENV IS_SANDBOX=1 \
    DISABLE_AUTOUPDATER=1

WORKDIR /home/agent/workspace
ENTRYPOINT ["bash"]
CMD ["-l"]
