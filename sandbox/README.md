# Agent sandbox

`agent-lab/` is a Docker Sandboxes kit with Claude Code, Codex, deepagents-code (`dcode`), and Pi with custom extensions. Versions, resources, and the network allowlist are in `agent-lab/agent-lab.yaml`. `sbxenv.yaml` declares the sandbox built from it: the workspace clone, host mounts, and credential bindings. On Windows, Docker Desktop must run on its WSL 2 engine.

## Usage

On the host, from the repo root:

```powershell
sbx login                                       # once
sbx secret set openai --oauth                   # once: ChatGPT login for Codex, dcode, and Pi
sbx secret set anthropic --oauth                # once: Claude login for Claude Code
gh auth status                                  # GitHub login on the host; run gh auth login if needed
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
claude --plugin-dir "$WORKSPACE_DIR/plugins/mzizzi"
codex
dcode
pi
gh api user --jq .login                         # verify GitHub proxy authentication
```

The clone starts from the committed ref; uncommitted files are readable at `/run/sandbox/source`. Bash history, Claude and pi sessions, and dcode threads are kept on the host in `%USERPROFILE%\.sandbox-state\agent-lab`, which `sbxenv.yaml` mounts. Claude Code uses the host Claude login, and Codex, dcode, and Pi use the host ChatGPT login, all through Docker's credential proxy; the sandbox only sees placeholder tokens. Don't log in inside the sandbox with `claude auth login`, dcode's `/auth`, or Pi's `/login`. Pi reaches the ChatGPT login through the kit's `chatgpt` provider in `~/.pi/agent/models.json`.

For IntelliJ remote development, run `sbx setup ssh` once on the host and save an SSH configuration for `agent-lab.sbx` using OpenSSH config authentication. The host needs Python 3 available as `python`. After each rebuild, `postCreate` refreshes the host-specific key entries IntelliJ 2026.2 needs in `~/.ssh/known_hosts`. The saved IntelliJ SSH configuration stays on the host across rebuilds. Select `/c/Users/Matt/code/mzizzi-dotfiles` as the remote project path; it is the private sandbox clone, not a read-write host mount.

The SSH setup script also runs on macOS with Python 3. The environment file still has Windows paths and a PowerShell network hook, so those need updating before using the full sandbox on macOS. If macOS only provides `python3`, change the SSH hook's lifecycle command to use it.

`sbxenv.yaml` reads the host's `gh auth token` when creating the sandbox. The kit gives `gh` a proxy-managed `GH_TOKEN` and configures it as Git's HTTPS credential helper. The real token stays on the host. `gh auth login` inside the sandbox is unnecessary; `GH_TOKEN` takes precedence over stored GitHub CLI logins. To refresh the host login, run `gh auth login` on the host and then `sbx secret set github --sandbox agent-lab --command 'gh auth token'` to update the existing sandbox without rebuilding it.

`pi/setup.sh` installs `pi/settings.json` as Pi's whole settings file, installs the web-access and sub-agent packages it pins, and appends the attention-control output style to Pi's system prompt. The kit runs it at creation against `%USERPROFILE%\code\attention-control`, which `sbxenv.yaml` mounts read-only; the SimRacing devcontainer runs the same script.

On every boot, the kit runs `agent-lab/bin/setup-pi.sh` to render the mzizzi Pi package and register it in user settings. `uv` supplies the renderer's pinned Python dependencies. Setup stops on render or registration failure. The package exposes all 15 mzizzi skills and five agents; the renderer test fixture is not included. This enables a sandbox pilot, not a replacement of the production Claude plugin.

The same script links custom extensions from `config/pi/extensions/` into `~/.pi/agent/extensions/`. It supports `.js` files, `.ts` files, and extension directories. It preserves unrelated extensions, existing package declarations, model settings, and `APPEND_SYSTEM.md`. User-level paths keep the package and extensions available after worktree entry.

Worktree transitions need an interactive parent session with no unfinished child work. Full implementation and PR review still need the current Codex review dependency; the native replacement is separate work.

Attention Control is one of those extensions. It uses the external style and adds a per-request reminder; its bundled style is a fallback when no style is already loaded. Extension code changes in the workspace take effect on `/reload`. After adding a new extension, run `bash sandbox/agent-lab/bin/setup-pi.sh` before `/reload` to create its link.

Run the setup tests from the repo root with `node --test sandbox/agent-lab/tests/*.test.mjs`.

## Traps

- The kit and `sbxenv.yaml` apply only at creation, so recreate the sandbox after editing either: `sbx env rm sandbox`, then `sbx env run sandbox`. The kit is read from the host directory, so uncommitted kit edits apply. To check that an edit builds without recreating, run `docker buildx build -f sandbox/agent-lab/agent-lab.yaml -t agent-lab:dev sandbox/agent-lab`.
- dcode loads the kit's MCP servers only inside a git repo such as the workspace. Elsewhere it treats the current directory as the project and skips them until you approve them.
- Keep the OpenAI credential declared before Anthropic in `agent-lab.yaml`. `sbx` treats the first as the primary OAuth service, and swapping them makes Codex and dcode fail with 401.
- `pi -p` reads stdin until EOF, and `sbx exec` leaves stdin open, so a scripted `sbx exec ... pi -p` hangs. Pass `</dev/null`.
- Keep extra host mounts outside the repo path. The clone overwrites a mount inside it, and `sbx` has deleted host files in one.
