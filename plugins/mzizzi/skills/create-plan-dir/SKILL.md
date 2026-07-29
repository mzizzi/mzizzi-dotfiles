---
name: create-plan-dir
description: Create a date-stamped plan directory (under plans/, or .nocommit/plans/ if the project doesn't track plans in source control) following the yyyymmdd-short-description/ convention, and return its path. Use this whenever you need the destination folder for a plan document — the create-plan skill calls it before writing plan.md, and you can invoke it directly whenever the user wants to scaffold a new plan folder or asks where a plan should live.
argument-hint: <topic or feature description>
allowed-tools: Bash
disable-model-invocation: false
user-invocable: true
---

# Create Plan Directory

Create the destination directory for a plan document and return its path. This is the single source of truth for the plan-directory naming convention, so anything that writes a plan (the `create-plan` skill, or a direct request) gets a consistent, date-stamped folder.

## Convention

Plan documents live at:

    <plans-base>/yyyymmdd-short-description/

- `yyyymmdd` — today's date, stamped automatically so the date never drifts or gets typed wrong.
- `short-description` — a short, kebab-case summary of the topic (lowercase, words joined by hyphens). Keep it to a few words that capture the essence.
- `<plans-base>` — `plans/` if the project already commits its plans to source control, otherwise `.nocommit/plans/` (gitignored) so plans don't get committed to a project that doesn't want them tracked. The script decides which to use; see its logic for the exact check.

Example: a plan about refreshing OAuth tokens → `plans/20260615-token-refresh/` (or `.nocommit/plans/20260615-token-refresh/` in a project without a tracked `plans/` dir). The plan file (`plan.md` by default, or a name the caller chooses) is then written inside that directory.

## How to create it

Run the bundled script, passing a short description of the topic. The script slugifies the text and stamps today's date, so you can pass natural phrasing — pick a concise summary rather than the user's whole sentence (e.g. pass `"OAuth token refresh"`, not `"I want to plan how we refresh OAuth tokens before they expire"`).

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-plan-dir/scripts/create_plan_dir.sh" "OAuth token refresh"
```

The script prints the created directory path (e.g. `plans/20260615-oauth-token-refresh/` or `.nocommit/plans/20260615-oauth-token-refresh/`) to stdout and creates it with `mkdir -p`, so re-running is harmless. Use the printed path for whatever comes next — typically writing `plan.md` inside it.

If running the script isn't possible in the current environment, fall back to creating the directory by hand: take today's date as `yyyymmdd`, slugify the topic to lowercase hyphen-separated words, and create `<plans-base>/<yyyymmdd>-<slug>/` — using `plans/` if that directory already exists in the project, otherwise `.nocommit/plans/`.
