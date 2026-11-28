# Pi Codex footer — Brainstorm

## The idea

Show the working directory, Git branch, Codex quota used, and time to reset on one Pi footer row. Reuse the quota status from the pinned `pi-codex-usage` extension. The local renderer does not read credentials or make requests.

## Decisions

### Footer contents

- **Question:** Which parts of the stock footer should the custom footer keep?
- **Decision:** Show the directory, optional branch, and available Codex status on the first row. Show other nonempty extension statuses on a second row only when they exist. Omit model, session name, and token and context stats.
- **Why:** Checked Pi's `setFooter` API: it replaces the whole footer. The user wants a small footer, and context percentage is not Codex quota. Keep unrelated extension messages so the layout change does not hide progress or warnings.

### Extension scope

- **Question:** Which component owns the layout and where does it run?
- **Decision:** Add a local extension under `config/pi/extensions/`. Register its renderer in TUI sessions only. Use the existing managed setup in the SimRacing devcontainer and agent-lab sandbox. Do not add a toggle or load the renderer from the portable dotfiles Pi package.
- **Why:** Checked `sandbox/agent-lab/bin/setup-pi.sh`: it links local extensions for both managed environments. Pi's `ExtensionContext.mode` distinguishes TUI from RPC. The managed environments already share the quota package declaration.

### Status and width

- **Question:** What should the footer show without quota data or with limited terminal width?
- **Decision:** Show the location without a placeholder if no Codex status exists. Keep the quota text unchanged, shorten the location first as needed, and clip the quota text when it alone exceeds the terminal width. Keep rows within the terminal width.
- **Why:** Checked the pinned source: the status may be absent without a login or before the first response. A stable layout avoids flicker. The quota reader needs a Pi Codex OAuth login, so the agent-lab proxy login alone does not produce quota status. The countdown is more useful than a long path when space is tight. Render control characters in the location as printable text so it stays on one row. Pi supplies the live status map, branch change events, and terminal-width helpers.

### Quota mode and dependency

- **Question:** How should the footer show percent used rather than percent left?
- **Decision:** Keep the reviewed Git commit pin. Set the quota extension's `usageMode` to `used` in the managed settings template. Let the upstream command change the mode during normal use, and render the resulting text unchanged.
- **Why:** Checked the pinned settings reader: it uses this mode directly. The renderer needs no second dependency, quota parser, or model request. A managed rebuild can restore the template default.
