FROM docker.io/docker/sandbox-templates:shell-docker@sha256:1560168ac5fb9ce23d413c878349334c5845c07e264cd675d7867f0c78ad1761

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends fd-find ripgrep \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# sbx runs kit startup commands through `su`, whose PAM session sets PATH from
# /etc/environment and so drops the image's tool directories (pi, pre-commit).
# This copies ENV PATH as of this step, so any later ENV PATH change belongs above it.
RUN sed -i '/^PATH=/d' /etc/environment && echo "PATH=\"$PATH\"" >> /etc/environment

USER agent
ARG CLAUDE_VERSION
ARG CODEX_VERSION
ARG PI_VERSION
RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_VERSION}" "@openai/codex@${CODEX_VERSION}" \
    && npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
    && claude --version \
    && codex --version \
    && pi --version

COPY pi/ /opt/pi-setup/

ARG DCODE_VERSION
# Matches the official installer: a stable release may pin a pre-release
# dependency, and the system Python is too new for prebuilt wheels of some
# dependencies (the image has no C compiler).
RUN uv tool install --no-cache --python 3.13 --prerelease allow "deepagents-code==${DCODE_VERSION}" \
    && dcode --version

RUN uv tool install --no-cache --python 3.13 "pre-commit==4.7.0" \
    && pre-commit --version

RUN mkdir -p /home/agent/.claude /home/agent/.codex /home/agent/.pi/agent /home/agent/.deepagents/.state

# Keep Bash history, Claude, dcode and pi sessions on the host; see state-dir.sh.
COPY shell/state-dir.sh /opt/agent-lab/state-dir.sh
RUN printf '\n. /opt/agent-lab/state-dir.sh\n' >> /home/agent/.bashrc

ENV IS_SANDBOX=1 \
    DISABLE_AUTOUPDATER=1

WORKDIR /home/agent/workspace
ENTRYPOINT ["bash"]
CMD ["-l"]
