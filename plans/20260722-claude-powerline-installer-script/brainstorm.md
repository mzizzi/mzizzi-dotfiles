# claude-powerline installer script — Brainstorm

## The idea

The claude-powerline statusline config lives at `~/.claude/claude-powerline.json` as an untracked, hand-tuned file. Nothing about it is captured in this repo, so it is unreproducible on a new machine and unrecoverable if lost.

The vendor's documented install path is `/plugin marketplace add Owloops/claude-powerline` → `/plugin install claude-powerline@claude-powerline` → `/powerline`, where the final step is an interactive wizard that writes the config file and sets the `statusLine` key in `~/.claude/settings.json`. That path works, but it produces a config through Q&A rather than from source control, and Claude Code's plugin system cannot set `statusLine` itself — a plugin's bundled `settings.json` supports only the `agent` and `subagentStatusLine` keys.

So the goal is a one-time setup script that reproduces the documented install non-interactively and adds the one thing the vendor path has no answer for: making a version-controlled config file the config that actually gets used.

## Decisions

### Script layout

- **Question:** Should the powerline setup logic be inlined into the existing `scripts/windows/install.ps1`, live in a separate script it calls, or be standalone and never auto-invoked?
- **Decision:** A separate script, invoked by `install.ps1`.
- **Why:** The statusline is a distinct concern from plugin wiring, and the work involved (symlink + settings merge) is substantially larger than the existing `Ensure-CodexDependency` helper — inlining would bury the plugin-wiring purpose the README documents. Keeping `install.ps1` as the caller preserves "one command sets up a machine" while leaving the powerline half independently re-runnable when iterating on just the statusline.

### Config mechanism

- **Question:** How should the repo's tracked config become the config claude-powerline actually loads — copy, symlink, `--config` flag, or `CLAUDE_POWERLINE_CONFIG` env var?
- **Decision:** Symlink `~/.claude/claude-powerline.json` to the repo file, failing loudly if the link cannot be created rather than falling back.
- **Why:** A symlink keeps the conventional path that the vendor wizard and all vendor docs refer to, while giving a single live source of truth with no copy to drift. Copying was rejected because two copies diverge and re-runs clobber hand edits. Failing loudly over falling back to `--config` was chosen for one guaranteed end state and the simplest mental model — no conditional branching in `settings.json`, at the cost of requiring an elevated run or Developer Mode.
- **Note:** An initial probe suggested symlinks were unavailable, but that reflected the assistant's unprivileged session, not the user's — the installer is run by the user, who can elevate.

### Config file location

- **Question:** Where in the repo should the tracked `claude-powerline.json` live?
- **Decision:** `config/claude-powerline.json`, a new platform-neutral top-level directory.
- **Why:** The file is pure JSON with no OS-specific content, so filing it under `scripts/windows/` would strand a cross-platform data file behind a Windows path and force a move when a second platform is added. Placing it inside `plugins/mzizzi/` was rejected because that plugin is published to a marketplace for other people — personal statusline layout is not plugin content.

### Installer language

- **Question:** PowerShell (with a Node or PowerShell-native JSON merge), or Python?
- **Decision:** Python, at `scripts/install_powerline.py`, invoked by `install.ps1` in one line.
- **Why:** Python is available on all of the user's machines, so availability is not a constraint. It collapses three decisions into one file: the `json` module handles the settings merge natively, which eliminates both the Node shell-out and the PowerShell→JS quoting problem, and moots where the JS would live. It is also cross-platform by construction, so a future macOS/Linux entry point is a launcher line rather than a rewrite. `install.ps1` stays PowerShell because `$PROFILE` editing is genuinely PowerShell-domain work.
- **Supersedes:** An earlier decision to shell out to `node -e` for the JSON merge.

### Overall approach

- **Question:** What is the most durable design, and what should it write?
- **Decision:** Converge on the documented vendor path — ensure the marketplace and plugin via the `claude plugin` CLI, write the documented unpinned `npx -y @owloops/claude-powerline@latest` statusLine command, and symlink the tracked config. The symlink is the sole custom addition.
- **Why:** Every value the installer writes should match what the vendor tooling would write, so the two never fight. Any divergence gets silently reverted the next time `/powerline` runs, producing a statusline that appears to change on its own. Version pinning and a global `npm install -g` were both rejected on these grounds — the global install is not a documented path at all, and a pinned version survives only until the next wizard run. Version drift is tolerable because config loading is a deep merge over `DEFAULT_CONFIG` with unrecognized fields copied and ignored: this is why the stale `type` and `burnType` fields in the current config sit inert rather than erroring.
- **Measured, and accepted:** `npx` costs roughly 730ms per render versus roughly 200ms invoking the binary directly. The statusline renders out of band, so this lags rather than blocking input.
- **Supersedes:** An earlier decision to `npm install -g` and call the binary directly.

### Existing-file conflict rule

- **Question:** What should the installer do when `~/.claude/claude-powerline.json` already exists as a real file rather than a symlink?
- **Decision:** Refuse — print the path and the remediation, exit non-zero.
- **Why:** Consistent with the fail-loudly stance taken on symlinks. The installer never touches data it did not create, so a config tuned in a wizard session and never committed cannot be destroyed or silently backed up into a file the user then has to notice. The cost is that post-wizard recovery becomes a two-step manual chore rather than one idempotent command.

### Failure propagation

- **Question:** When the powerline installer exits non-zero, should `install.ps1` abort or continue?
- **Decision:** Warn and continue, surfacing the message and the re-run command, then finish the plugin wiring and exit 0.
- **Why:** Matches the existing `Ensure-CodexDependency` precedent, which is deliberately best-effort so that an adjunct concern cannot block the core install. Fail-loudly is preserved where it matters — the Python script still exits non-zero with an explicit, actionable message — it simply does not abort unrelated work that succeeded. The tradeoff accepted is that exit 0 no longer means "everything is set up".

### Uninstall scope

- **Question:** Should the installer support uninstall, and how much should it revert?
- **Decision:** `--uninstall` removes the symlink and deletes the `statusLine` key from `settings.json`; `install.ps1 -Uninstall` calls it. The marketplace and plugin are left alone.
- **Why:** Reverts precisely what the installer wrote and nothing more, matching the precedent set by `install.ps1 -Uninstall`, which removes only its own profile line and explicitly leaves `claude-shim.ps1` and the codex plugin in place. Marketplace and plugin removal belongs to `/plugin uninstall`, the documented mechanism.

### Settings backup

- **Question:** Should `settings.json` be backed up before modification?
- **Decision:** No backup.
- **Why:** Keeps the script's side effects to exactly the two things it is documented to change. `settings.json` is small and its contents are reconstructible from the Claude Code UI, and a stale `.bak` in `~/.claude` invites restoring old plugin state months later.

### Verification

- **Question:** Should the installer render a sample statusline to confirm the install worked?
- **Decision:** No verification.
- **Why:** Any problem surfaces immediately in the next session, where it can be debugged against real data rather than a synthetic payload. Keeps the script small and the run fast, avoiding a ~730ms npx invocation and a sample payload committed to the repo purely for testing.

## Open questions

- **`/powerline` clobber risk.** The wizard writes _both_ files the installer manages. Re-running it may replace the symlink with a regular file — after which edits stop reaching the repo silently — and may rewrite the `statusLine` key. The intended recovery is re-running the installer, but with the refuse-on-real-file rule now in place, that recovery requires manually removing the clobbered file first. Worth deciding whether the refusal message should call this out explicitly as the expected post-wizard path.
- **Elevation error message.** Symlink creation needs either an elevated shell or Windows Developer Mode. Not settled whether the failure message should name both remedies, or steer toward one.
- **Seeding the tracked config.** Moving the current `~/.claude/claude-powerline.json` into `config/` is a one-time repo-authoring step, not installer logic. Needs doing before the installer is useful.
- **Non-Windows entry point.** The Python script is platform-neutral by construction, but only the Windows entry point (`install.ps1`) exists. No decision on when or whether to add a shell launcher.
- **README.** The existing "Windows setup" section documents `install.ps1` and its options; it will need to cover what the powerline half does and the elevation requirement.
