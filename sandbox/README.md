# Agent sandbox

`agent-lab/` is a local Docker Sandboxes workload with Claude Code, Codex, and Pi installed. Codex uses ChatGPT subscription authentication through Docker's host-side credential proxy. Claude uses its native subscription login inside the sandbox. Pi has no provider configuration or extensions installed.

**Current verification:** the v3 image builds and all three CLIs launch under `sbx` 0.47.0 on Windows. Clone isolation, proxy access to npm, and the sandbox's Git remote work. Real Codex and Claude requests succeed using the ChatGPT and Claude Max subscriptions respectively.

`sbx` 0.47 selects the first declared credential as the primary OAuth service. Keep OpenAI before Anthropic in the descriptor: reversing them selects Anthropic and makes Codex send its placeholder token unchanged, producing HTTP 401. Existing sandboxes retain their credential selection; recreate them after changing the descriptor. The lab requests 4 CPUs and 8 GiB of memory.

The kit uses the [v3 format](https://docs.docker.com/ai/sandboxes/customize/author/) and requires `sbx` 0.45 or newer. On Windows, start Docker Desktop with its WSL 2 Linux engine before building this local kit. Docker Buildx builds the image; `sbx` runs it in a separate microVM. Agent versions are pinned in the descriptor; the Docker shell template supplies the development tools and microVM integration.

To check a kit edit without creating a sandbox, build its descriptor:

```powershell
docker buildx build -f sandbox/agent-lab/agent-lab.yaml -t agent-lab:dev sandbox/agent-lab
```

The installed `sbx` 0.47.0 does not support `sbx kit validate` for v3 source directories. Creating a sandbox from the directory also builds and validates the kit.

## Subscription login

Run these commands from your normal host terminal. Sign in to Docker if needed:

```powershell
sbx login
sbx secret set openai --oauth
```

The second command starts the [ChatGPT subscription login](https://docs.docker.com/ai/sandboxes/agents/codex/) on the host. Open the printed URL if a browser does not open automatically. It does not require an OpenAI API key. Codex's provider configuration sends requests to the ChatGPT endpoint using a placeholder that the Sandbox proxy replaces with the real subscription token.

Approve the kit's OAuth credential bindings when `sbx` prompts. No API-key credentials are declared by this kit, and host agent configuration directories are not mounted.

After opening the sandbox shell, sign in to Claude:

```bash
claude auth login --claudeai
claude auth status
```

Complete the browser flow and paste the authorization code into the terminal if prompted. This uses your Claude subscription. In `sbx` 0.47, the secondary Anthropic service's login and inference requests bypass credential interception, so Claude keeps its OAuth credentials inside the sandbox rather than in Docker's host credential store. The login persists while the sandbox exists; sign in again after recreating it.

## Start

From this repo's root, create an isolated experimental workspace:

```powershell
sbx run --clone --skills off --name agent-lab ./sandbox/agent-lab .
```

This opens Bash. Clone mode starts from the checked-out Git ref, rather than copying uncommitted changes. The host checkout is available read-only at `/run/sandbox/source`; copy individual edited or untracked files from there into the sandbox workspace when needed. Changes made inside the clone stay inside the sandbox. For example, inside Bash:

```bash
cp /run/sandbox/source/config/CLAUDE.md ./config/CLAUDE.md
```

To edit the host checkout directly instead, omit `--clone` and use a different sandbox name. Workspace mode is fixed when the sandbox is created.

Inside the shell, start an agent:

```bash
claude --plugin-dir "$WORKSPACE_DIR/plugins/mzizzi"
codex
pi
```

Claude loads the local plugin from the sandbox's working copy. Codex uses the subscription provider configured by the kit. Pi is installed but remains unconfigured; set it up manually when you are ready. Configuration and sessions persist while the sandbox exists. The host's Windows-specific dotfiles installer is not run.

## Network access

From host PowerShell, allow all outbound TCP destinations or restore the existing allowlist:

```powershell
.\sandbox\agent-lab\bin\network-open.ps1
.\sandbox\agent-lab\bin\network-restrict.ps1
```

Both scripts default to `agent-lab`; pass `-Sandbox <name>` for another sandbox. Changes take effect immediately without restarting. Explicit deny rules still apply when access is open. Restricting access removes only the wildcard allowance; other allowed destinations remain accessible.

## Resume and review

From the host:

```powershell
sbx run --name agent-lab
sbx exec -it agent-lab bash
```

Use `sbx run` to resume the shell, or `sbx exec` for another shell in the same workspace. See each CLI's help for agent-specific session resumption.

For clone mode, commit changes inside the sandbox, then fetch its Git remote on the host:

```powershell
git fetch sandbox-agent-lab
git branch -r
```

Review the desired branch before cherry-picking commits into this checkout. You can also export individual files with `sbx cp`; sandbox paths must be absolute. See Docker's [Git workflows](https://docs.docker.com/ai/sandboxes/workflows/git/) and [copy commands](https://docs.docker.com/ai/sandboxes/usage/#copy-files-between-host-and-sandbox).

Stop the sandbox with `sbx stop agent-lab`. Removing it with `sbx rm agent-lab` discards the clone and sandbox-local configuration, so export work you want to retain first. To test kit or agent-version changes, create a sandbox with a new name; reattaching does not reapply the kit.
