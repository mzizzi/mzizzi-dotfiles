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
- `<plans-base>` — the nearest existing `plans/` at or above the current directory, stopping at the repo root; failing that, `<repo-root>/.nocommit/plans/` (gitignored) so plans don't get committed to a project that doesn't want them tracked. Resolving against the repo rather than the current directory is what stops a run from a subdirectory starting a second plans tree. The script decides; see its logic for the exact walk.

Example: a plan about refreshing OAuth tokens → `<repo-root>/plans/20260615-token-refresh/`. The plan file (`plan.md` by default, or a name the caller chooses) is then written inside that directory.

## How to create it

Run the bundled script, passing a short description of the topic. The script slugifies the text and stamps today's date, so you can pass natural phrasing — pick a concise summary rather than the user's whole sentence (e.g. pass `"OAuth token refresh"`, not `"I want to plan how we refresh OAuth tokens before they expire"`).

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-plan-dir/scripts/create_plan_dir.sh" "OAuth token refresh"
```

The script prints an **absolute** path to stdout and creates the directory with `mkdir -p`, so re-running is harmless and the caller never has to resolve the result against a working directory. Use the printed path as-is for whatever comes next — typically writing `plan.md` inside it. It errors out if run outside a git repository, since the base is resolved against the repo root.

If running the script isn't possible in the current environment, fall back to creating the directory by hand: take today's date as `yyyymmdd`, slugify the topic to lowercase hyphen-separated words, and create `<plans-base>/<yyyymmdd>-<slug>/` using the base rule above.
