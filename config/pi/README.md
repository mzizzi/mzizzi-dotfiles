# Pi extensions

Place custom extensions under `extensions/` as `.js` files, `.ts` files, or directories with a Pi entry point such as `index.js`. Keep supporting files inside each extension's directory.

The sandbox kit links all extensions on every boot. To install them manually or add a new extension during a session, run from the repo root:

```sh
bash sandbox/agent-lab/bin/setup-pi.sh
```

Run `/reload` in Pi after setup or code changes. The setup script keeps unrelated installed extensions.

## Attention Control

`extensions/attention-control/` bundles the full style in `style.md`. The extension adds it to the system prompt automatically. No separate `APPEND_SYSTEM.md` setup is needed. If the system prompt already contains a standalone `# Attention Control` heading, the extension keeps that style instead of adding a second copy.

The extension also adds a hidden reminder before each model request, including after tool calls. The reminder follows the conversation without changing existing messages or saved session history. It reinforces the style; it does not enforce response length.

The sandbox's existing `pi/setup.sh` copies the host-mounted output style into `APPEND_SYSTEM.md` at creation. That external style takes precedence over the bundled `style.md`; the extension still adds its reminder. Extension code changes in the sandbox checkout take effect on `/reload`. Host style changes need another run of `pi/setup.sh` before `/reload` because that script copies the file rather than linking it.

## Tasks

`extensions/tasks/` vendors a minimal task tracker from [tintinweb/pi-tasks](https://github.com/tintinweb/pi-tasks). It registers `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate`, with dependency warnings and a task widget above the editor. `/tasks` shows the full list.

Pi session history stores tasks on the active branch. Resume, reload, fork, tree navigation, and compaction retain the corresponding state. New sessions start empty. No separate task files, npm packages, background processes, or subagent extension are needed.

Completed tasks remain until `TaskUpdate` removes them with `status: "deleted"`. A hidden reminder includes unfinished tasks before each model request. The widget shows up to five tasks; the reminder includes up to ten. See `extensions/tasks/UPSTREAM.md` for source attribution, limits, and omitted features.

Do not load upstream `pi-tasks` alongside this extension; their tool names overlap. The existing setup command installs both local extensions.

## Tests

Run from the repository root:

```sh
node --test config/pi/tests/*.test.mjs sandbox/agent-lab/tests/*.test.mjs
```
