# Pi Codex footer

## Context

The managed Pi profile uses the stock footer, which places quota status below the directory and branch. Put Codex quota and its reset time on the location row. Keep the reviewed quota extension as the only component that reads credentials or makes quota requests. See [brainstorm.md](brainstorm.md) for the layout decisions. Quota needs a Pi `openai-codex` OAuth login with an account ID. A proxy-only agent-lab profile shows location without quota. An existing profile without the package pin needs the updated managed setup, not just `/reload`.

## Design

The local `codex-footer` extension registers a custom component at `session_start` when `ctx.mode === "tui"`. Pi's `setFooter` API replaces the footer. Use session CWD and `footerData.getGitBranch()` for the location. Replace terminal control characters in the location with printable placeholders before measuring its width. Then read `footerData.getExtensionStatuses()` each render. Use the `codex-usage` entry verbatim, apart from terminal truncation. If it is absent, show the location alone. Keep other nonempty extension statuses on an optional second row, sorted by key, with line breaks and tabs flattened as Pi does. Do not reproduce the stock model, session name, or token/context stats.

Use Pi TUI's `visibleWidth` and `truncateToWidth` so ANSI styles and wide characters do not cause wrapping. When space is tight, truncate the location to leave room for quota. If the quota leaves no room for a location and separator, show the quota alone, clipped if needed. Subscribe to branch changes, request a render from the callback, and release the subscription in `dispose()`. Pi already requests a render when an extension status changes. Do not add timers, requests, or a command to toggle the footer.

## Implementation

### Implementation Phase 1: Add and check the managed footer

- `config/pi/extensions/codex-footer/index.js`: Export `default function (pi)` and register `pi.on("session_start", ...)`. The `ctx.ui.setFooter` callback returns a component with `render(width)`, `invalidate()`, and `dispose()`. The managed setup already links extension directories with this structure. Leave the portable package manifest unchanged.
- `sandbox/agent-lab/pi/settings.json`: Carry the completed upstream review's pin, `git:github.com/calesennett/pi-codex-usage@0dedd7af2e9eed2cd7d2a942f0617f8a86751f0e`, into this branch. Configure `pi-codex-usage.usageMode` as `used`. Leave other settings intact. The separate main checkout has the same pin as an uncommitted edit; do not change that checkout.
- `config/pi/tests/codex-footer.test.mjs` and existing setup tests: Exercise the registered renderer with synthetic statuses and a fake footer data provider. Use the installed Pi loader and TUI helpers where needed, following the existing test host discovery. Check initial and updated quota, branch presence and redraw/dispose, non-TUI mode, secondary statuses, and terminal width with ANSI and wide characters. Check that a CWD with a newline and escape stays on one row. Add the footer link, exact pin, and `used` assertions to the existing shared-setup case in `sandbox/agent-lab/tests/setup-pi.test.mjs`. Do not install packages, start the upstream extension, or read credentials to test layout.

## Follow-ups

- _None yet._
