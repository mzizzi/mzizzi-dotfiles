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

The clone starts from the committed ref; uncommitted files are readable at `/run/sandbox/source`. Bash history, Claude and pi sessions, dcode threads, and the IntelliJ backend archive cache are kept on the host in `%USERPROFILE%\.sandbox-state\agent-lab`, which `sbxenv.yaml` mounts. Claude Code uses the host Claude login, and Codex, dcode, and Pi use the host ChatGPT login, all through Docker's credential proxy; the sandbox only sees placeholder tokens. Don't log in inside the sandbox with `claude auth login`, dcode's `/auth`, or Pi's `/login`. Pi reaches the ChatGPT login through the kit's `chatgpt` provider in `~/.pi/agent/models.json`.

For IntelliJ remote development, run `sbx setup ssh` once on the host. The host needs Python 3 available as `python`. On each create, `postCreate` runs `agent-lab/bin/setup-intellij.py`, which prepares the newest IntelliJ IDEA installed on the host:

- It refreshes the host-specific key entries IntelliJ's SSH client needs in `~/.ssh/known_hosts`.
- It downloads the Linux backend for that IDE's exact build, checks it against the SHA-256 that JetBrains publishes, and caches it under the mounted `.sandbox-state` directory. A rebuild reuses the cached archive; a new host IDE build replaces it.
- It unpacks the backend into the container next to the backends IntelliJ deploys, not onto the Windows mount.
- It adds the `agent-lab.sbx` OpenSSH configuration (if missing) and a recent project for the workspace clone to that IDE's options directory, keeping each changed file's previous version as `<file>.bak`.

Open the recent project from IntelliJ's Remote Development welcome screen; it starts the unpacked backend without downloading one or asking for a project path. The project is the private sandbox clone, not a read-write host mount. IntelliJ rewrites these options files from memory on exit, so the script skips them while IntelliJ is running and prints the command to rerun after quitting it. Rerunning is safe; every step is skipped when already done.

The IntelliJ setup script also runs on macOS with Python 3. The environment file still has Windows paths and a PowerShell network hook, so those need updating before using the full sandbox on macOS. If macOS only provides `python3`, change the IntelliJ hook's lifecycle command to use it.

`sbxenv.yaml` reads the host's `gh auth token` when creating the sandbox. The kit gives `gh` a proxy-managed `GH_TOKEN` and configures it as Git's HTTPS credential helper. The real token stays on the host. `gh auth login` inside the sandbox is unnecessary; `GH_TOKEN` takes precedence over stored GitHub CLI logins. To refresh the host login, run `gh auth login` on the host and then `sbx secret set github --sandbox agent-lab --command 'gh auth token'` to update the existing sandbox without rebuilding it.

`pi/setup.sh` installs `pi/settings.json` as Pi's whole settings file and installs the web-access and sub-agent packages it pins. The kit runs it at creation without arguments. Pi's Attention Control extension owns the full style in this repo; setup needs no external style checkout or host mount.

On every boot, the kit runs `agent-lab/bin/setup-pi.sh` to render the mzizzi Pi package with `--target pi` and register `ai-rendered/pi/packages/mzizzi` in user settings. `uv` supplies the renderer's [pinned Python dependencies](../ai-renderer/requirements.txt); rendering needs Python >=3.11. Setup stops on render or registration failure. Unchanged sources render identical bytes; source edits can update tracked output for review. Commit acceptance still requires both targets, so run `python ai-renderer/render_ai.py` before staging a source change. The package exposes all 15 mzizzi skills and six agents; the renderer test fixture is not included. This enables a sandbox pilot, not a replacement of the production Claude plugin or marketplace.

Setup migrates only this checkout's old `generated/pi/packages/mzizzi` registrations. Strings and source-only objects migrate automatically, including relative paths. If an old object has restrictions such as `skills: []`, setup stops before any remove/install call: change only its `source` to the reported new absolute path, preserve all other fields, then rerun setup. Malformed settings also stop before registration changes. CLI failures are reported; rerun setup to repair a removal followed by failed installation. The ignored retired package directory is never deleted. Custom `PI_CODING_AGENT_DIR` profiles remain supported.

`agent-lab/bin/setup-pre-commit.sh` runs `pre-commit install --install-hooks` idempotently; defaults install both commit and push hooks. Existing clones must rerun it (or `python -m pre_commit install --install-hooks`). Hooks need Python >=3.11 and Node >=22 and provision isolated dependencies pinned in [the hook configuration](../.pre-commit-config.yaml). Authored Markdown is formatted at commit time; candidate/output checks are read-only and never stage files. Fix output formatting/lint in `ai/`, regenerate, review, and stage intended source/output paths. The only rendered Markdown exceptions are the two exact vendored review-prompt copies; see [renderer checks](../ai-renderer/README.md#commit-and-push-checks).

Push checks require relevant source/output/config files to match `HEAD`; a staged repair must be committed first. These bypassable local hooks cover the checked-out branch, not arbitrary other branches, every ref of a multi-ref push, or every intermediate commit. They are not server-side checks.

The same script links custom extensions from `config/pi/extensions/` into `~/.pi/agent/extensions/`. It supports `.js` files, `.ts` files, and extension directories. It preserves unrelated extensions, existing package declarations, model settings, and `APPEND_SYSTEM.md`. User-level paths keep the package and extensions available after worktree entry.

Worktree transitions need an interactive parent session with no unfinished child work. Pi's `adversarial-review` skill uses a fresh Astra/high child through `pi-subagents`; it needs neither the Claude Codex plugin nor Codex CLI. The generated Claude skill retains those Codex dependencies. Both use the same review prompt and structured outcome contract.

Attention Control is one of those extensions. It loads the full prompt from `config/pi/extensions/attention-control/style.md` and adds a per-request reminder. Edit that file to change the Pi style, including its narrow task-tracking policy. Style and extension changes in the workspace take effect on `/reload`. After adding a new extension, run `bash sandbox/agent-lab/bin/setup-pi.sh` before `/reload` to create its link.

For an older sandbox, move the generated `~/.pi/agent/APPEND_SYSTEM.md` aside before `/reload` if it contains only Attention Control. Keep any user-authored instructions. New sandboxes do not create this file.

Run the setup tests from the repo root with `node --test sandbox/agent-lab/tests/*.test.mjs` and `python -m unittest discover -s sandbox/agent-lab/tests`.

## Traps

- The kit and `sbxenv.yaml` apply only at creation, so recreate the sandbox after editing either: `sbx env rm sandbox`, then `sbx env run sandbox`. The kit is read from the host directory, so uncommitted kit edits apply. To check that an edit builds without recreating, run `docker buildx build -f sandbox/agent-lab/agent-lab.yaml -t agent-lab:dev sandbox/agent-lab`.
- dcode loads the kit's MCP servers only inside a git repo such as the workspace. Elsewhere it treats the current directory as the project and skips them until you approve them.
- Keep the OpenAI credential declared before Anthropic in `agent-lab.yaml`. `sbx` treats the first as the primary OAuth service, and swapping them makes Codex and dcode fail with 401.
- `pi -p` reads stdin until EOF, and `sbx exec` leaves stdin open, so a scripted `sbx exec ... pi -p` hangs. Pass `</dev/null`.
- `codex login status` reports "Not logged in" even though Codex works. The kit sends Codex through the proxy with a placeholder token, so Codex has no saved login of its own. Test with a real request, e.g. `codex exec "reply with just: ok"`.
- Keep extra host mounts outside the repo path. The clone overwrites a mount inside it, and `sbx` has deleted host files in one.
