# Tasks source

Adapted from [tintinweb/pi-tasks](https://github.com/tintinweb/pi-tasks), commit [`c820715be1bf05db36d0739e88061b97b8c2c9d3`](https://github.com/tintinweb/pi-tasks/tree/c820715be1bf05db36d0739e88061b97b8c2c9d3/src), under the MIT license in `LICENSE`.

`store.js` retains the task model, CRUD behavior, bidirectional dependencies, and dependency warnings from `src/task-store.ts`. The extension uses a new minimal JavaScript entry point rather than upstream's execution and UI framework.

Local changes:

- Pi session entries replace external task files and locking. Tasks belong to the active branch and survive resume, reload, fork, and compaction. Ephemeral sessions do not persist after exit.
- Four tools remain: `TaskCreate`, `TaskList`, `TaskGet`, and `TaskUpdate`. Owner and metadata fields are omitted.
- A static widget shows up to five tasks, with active tasks first. `/tasks` shows the full list through a notification.
- A transient reminder echoes up to ten unfinished tasks before each model request. No reminder appears for an empty or completed list.
- Subagents, process tracking, execution tools, automatic cascade, timers, auto-clear, shared lists, and settings menus are omitted. Completed tasks remain until explicitly removed.

Limits live in `index.js` and `store.js`: 100 tasks, 200-character subjects and active forms, 4,000-character descriptions, and 100 dependencies in each direction per task. Task IDs are positive decimal strings of up to 20 digits. Summaries show up to five open blockers; `TaskGet` returns all dependency IDs. Tool output truncates at 48 KiB with a notice. Dependencies produce warnings; they do not prevent manual status changes. Cycle warnings cover self-dependencies and direct two-task cycles, not longer cycles.

Do not also load upstream `pi-tasks`: both extensions register the same task tool names.
