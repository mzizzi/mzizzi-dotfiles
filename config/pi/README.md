# Pi extensions

Place custom extensions under `extensions/` as `.js` files, `.ts` files, or directories with a Pi entry point such as `index.js`. Keep supporting files inside each extension's directory.

The sandbox kit links all extensions on every boot. To install them manually or add a new extension during a session, run from the repo root:

```sh
bash sandbox/agent-lab/bin/setup-pi.sh
```

Run `/reload` in Pi after setup or code changes. The setup script keeps unrelated installed extensions.

## Attention Control

`extensions/attention-control/style.md` is the complete, repo-managed Pi style. Edit it directly; the extension adds it to the system prompt automatically. No external checkout, host mount, generated prompt, or text filter is needed. The copy retains its upstream license and attribution in the extension directory.

Task tracking is opt-in for explicit requests or long-horizon work that needs persistent state across substantial phases or interruptions. Questions, short investigations, small edits, and routine edit-and-test work do not need task tools.

The extension also adds a hidden reminder before each model request, including after tool calls. The reminder follows the conversation without changing existing messages or saved session history. It reinforces the style; it does not enforce response length.

Style and extension changes take effect on `/reload`. Setup no longer creates `APPEND_SYSTEM.md` and leaves user-authored append files alone. If an older sandbox contains the generated Attention Control append file, move that file aside before `/reload`; otherwise the extension skips its bundled style to avoid a duplicate.

## Tasks

`extensions/tasks/` vendors a minimal task tracker from [tintinweb/pi-tasks](https://github.com/tintinweb/pi-tasks). It registers `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate`, with dependency warnings and a task widget above the editor. `/tasks` shows the full list.

Pi session history stores tasks on the active branch. Resume, reload, fork, tree navigation, and compaction retain the corresponding state. New sessions start empty. No separate task files, npm packages, background processes, or subagent extension are needed.

Completed tasks remain until `TaskUpdate` removes them with `status: "deleted"`. A hidden reminder includes unfinished tasks before each model request. The widget shows up to five tasks; the reminder includes up to ten. See `extensions/tasks/UPSTREAM.md` for source attribution, limits, and omitted features.

Do not load upstream `pi-tasks` alongside this extension; their tool names overlap. The existing setup command installs all local extensions.

## Worktrees (interactive pilot)

`extensions/worktree/` adds `EnterWorktree({path})` and `ExitWorktree({action:"keep"})`. It enters existing registered worktrees, including dirty and detached checkouts. The tool schemas advertise only these supported arguments; `name`, removal, and discard requests remain unsupported. It never creates, cleans, or removes a checkout or branch. Git policy stays in the skills.

Use a persisted interactive parent session. Call each transition alone. Finish all child work, interviews, and pending results before switching. Confirm that condition in the dialog. If pi-subagents reveals live work, choose **Stay**, not Take or Leave. The extension cannot enumerate every child; unattended or live-child switching is unsupported.

Pi replaces the runtime and copies the active conversation, tasks, and compaction history into a new session at the destination. The session ID/file changes. A tool result of **scheduled** is not success: continuation starts only after the fresh runtime checks its cwd and source transcript. Destination settings, instructions, and resources reload under normal project trust. Keep the extension and active skill sources at stable user-level paths.

Exit returns to the exact first-entry cwd, including a subdirectory. Path hops retain that first origin; there is no nesting stack. A review started from a feature worktree must return by path to that feature worktree, not unconditionally exit. Implementation does not automatically exit.

### Cancellation and recovery

New input normally cancels the pending switch in the source session. The settled command returns before a deferred dispatch starts replacement, so accepted settlement input reaches its hooks first. Shutdown cancels that dispatch. The extension blocks mixed tool batches, other tools, and `!`/`!!` while pending. It also checks the source transcript before allowing destination continuation. Pi has no atomic queue/switch API: late cancellation during another extension's switch guard can leave a prepared destination runtime. That runtime blocks tools and does not continue the skill. No automatic rollback is available after teardown.

1. Run `/worktree-status` to see native cwd, state, and source/destination session paths.
2. In a source session with pending state, run `/worktree-cancel` before retrying. Reload/crash never replays an intent automatically.
3. If replacement failed, restart with `pi --session <source-session-file>` from the error. Keep both transcripts until recovery completes.

Use the replacement session path to resume work. Directory-scoped `--continue` in the old checkout can select the pre-switch conversation. Conflicting `/tree` state or missing checkout identity blocks transitions; resume a known session rather than guessing the origin. Shutdown never removes worktrees.

This is cwd switching, not filesystem isolation. Absolute paths, custom tools, fixed-scope MCP servers, and remote services can still access elsewhere. Trusted extension hooks can run before tool guards. The tools do not add Claude permission escalation, preapproval, sandboxing, or worktree hooks.

### Compatibility and checks

Host contract tests target Pi 1.5.0. The skill pilot uses pi-subagents 0.87.0 and the local task extension. Test newer versions before relying on them. Linux is the checked platform. Native Windows/Git Bash checks are outside the current sandbox scope.

Real-host tests use a local scripted provider, disposable repositories, and Pi's actual runtime/file loader. They cover mixed batches, replacement, relative tools, tasks/history, dirty/detached paths, source subdirectories, path hops, queues, and failures. They make no model requests.

Linux pseudo-terminal tests run the real CLI with isolated profiles and a scripted provider. They check entry/return dialogs, late terminal input without false completion, and a native child/supervisor request and reply after entry. A real stdio MCP fixture checks its cwd, shutdown, and reconnection after entry, a dropped connection, and return. These bounded checks do not prove every terminal race, arbitrary MCP behavior, or full model-driven skill parity.

## Tests

Run from the repository root:

```sh
node --test config/pi/tests/*.test.mjs sandbox/agent-lab/tests/*.test.mjs
```

Runtime tests find the installed `pi` CLI. Without Pi they report a skip; set `PI_WORKTREE_HOST` to its `dist/index.js` to check another installation. An explicit invalid host path fails the suite.
