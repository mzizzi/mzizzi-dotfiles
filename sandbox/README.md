# Agent sandbox

`agent-lab/` is a Docker Sandboxes kit with Claude Code, Codex, deepagents-code (`dcode`), and Pi. Versions, resources, and the network allowlist are in `agent-lab/agent-lab.yaml`. `sbxenv.yaml` declares the sandbox built from it: the workspace clone, host mounts, and credential bindings. On Windows, Docker Desktop must run on its WSL 2 engine.

## Usage

On the host, from the repo root:

```powershell
sbx login                                       # once
sbx secret set openai --oauth                   # once: ChatGPT login for Codex, dcode, and Pi
sbx env run sandbox                             # create (network open) if missing, attach
sbx env exec -it sandbox -- bash                # second shell
.\sandbox\agent-lab\bin\network-restrict.ps1    # limit outbound to the kit allowlist
.\sandbox\agent-lab\bin\network-open.ps1        # allow all outbound again
git fetch sandbox-agent-lab                     # get committed work out
sbx stop agent-lab
sbx env rm sandbox                              # discards the clone; fetch first
```

Inside the sandbox:

```bash
claude auth login --claudeai                    # repeat after each recreate
claude --plugin-dir "$WORKSPACE_DIR/plugins/mzizzi"
codex
dcode
pi
```

The clone starts from the committed ref; uncommitted files are readable at `/run/sandbox/source`. Bash history, Claude and pi sessions, the Claude login, and dcode threads are kept on the host in `%USERPROFILE%\.sandbox-state\agent-lab`, which `sbxenv.yaml` mounts. Codex, dcode, and Pi use the host ChatGPT login through Docker's credential proxy, so don't use dcode's own `/auth` or Pi's `/login`. Pi reaches it through the kit's `chatgpt` provider in `~/.pi/agent/models.json`.

`pi/setup.sh` installs `pi/settings.json` as Pi's whole settings file, installs the web-access and sub-agent packages it pins, and appends the attention-control output style to Pi's system prompt. The kit runs it at creation against `%USERPROFILE%\code\attention-control`, which `sbxenv.yaml` mounts read-only; the SimRacing devcontainer runs the same script.

## Traps

- The kit and `sbxenv.yaml` apply only at creation, so recreate the sandbox after editing either: `sbx env rm sandbox`, then `sbx env run sandbox`. The kit is read from the host directory, so uncommitted kit edits apply. To check that an edit builds without recreating, run `docker buildx build -f sandbox/agent-lab/agent-lab.yaml -t agent-lab:dev sandbox/agent-lab`.
- dcode loads the kit's MCP servers only inside a git repo such as the workspace. Elsewhere it treats the current directory as the project and skips them until you approve them.
- Keep the OpenAI credential declared before Anthropic in `agent-lab.yaml`. `sbx` treats the first as the primary OAuth service, and swapping them makes Codex and dcode fail with 401.
- `pi -p` reads stdin until EOF, and `sbx exec` leaves stdin open, so a scripted `sbx exec ... pi -p` hangs. Pass `</dev/null`.
- Keep extra host mounts outside the repo path. The clone overwrites a mount inside it, and `sbx` has deleted host files in one.
