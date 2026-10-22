# Agent sandbox

`agent-lab/` is a Docker Sandboxes kit with Claude Code, Codex, deepagents-code (`dcode`), and Pi (installed, unconfigured). Versions, resources, and the network allowlist are in `agent-lab/agent-lab.yaml`. On Windows, Docker Desktop must run on its WSL 2 engine.

## Usage

On the host, from the repo root:

```powershell
sbx login                                       # once
sbx secret set openai --oauth                   # once: ChatGPT login for Codex and dcode
bash sandbox/agent-lab/bin/rebuild.sh           # (re)create with open network
sbx run --name agent-lab                        # resume
sbx exec -it agent-lab bash                     # second shell
.\sandbox\agent-lab\bin\network-open.ps1        # allow all outbound
.\sandbox\agent-lab\bin\network-restrict.ps1    # back to the kit allowlist
git fetch sandbox-agent-lab                     # get committed work out
sbx stop agent-lab
sbx rm agent-lab                                # discards the clone; fetch first
```

Inside the sandbox:

```bash
claude auth login --claudeai                    # repeat after each recreate
claude --plugin-dir "$WORKSPACE_DIR/plugins/mzizzi"
codex
dcode
```

The clone starts from the committed ref; uncommitted files are readable at `/run/sandbox/source`. Bash history, Claude sessions and login, and dcode threads are kept on the host in `%USERPROFILE%\.sandbox-state\agent-lab`, which `rebuild.sh` mounts. Codex and dcode use the host ChatGPT login through Docker's credential proxy, so don't use dcode's own `/auth`.

## Traps

- The kit applies only at creation, so recreate the sandbox after editing it. It is read from the host directory, so uncommitted kit edits apply. To check that an edit builds without recreating, run `docker buildx build -f sandbox/agent-lab/agent-lab.yaml -t agent-lab:dev sandbox/agent-lab`.
- dcode loads the kit's MCP servers only inside a git repo such as the workspace. Elsewhere it treats the current directory as the project and skips them until you approve them.
- Keep the OpenAI credential declared before Anthropic in `agent-lab.yaml`. `sbx` treats the first as the primary OAuth service, and swapping them makes Codex and dcode fail with 401.
- Keep extra host mounts outside the repo path. The clone overwrites a mount inside it, and `sbx` has deleted host files in one.
