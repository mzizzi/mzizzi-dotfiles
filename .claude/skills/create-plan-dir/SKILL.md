---
name: create-plan-dir
description: Create a date-stamped plan directory under plans/ following the plans/yyyymmdd-short-description/ convention, and return its path. Use this whenever you need the destination folder for a plan document — the create-plan skill calls it before writing plan.md, and you can invoke it directly whenever the user wants to scaffold a new plan folder or asks where a plan should live.
argument-hint: <topic or feature description>
allowed-tools: Bash
---

# Create Plan Directory

Create the destination directory for a plan document and return its path. This is the single source of truth for the plan-directory naming convention, so anything that writes a plan (the `create-plan` skill, or a direct request) gets a consistent, date-stamped folder.

## Convention

Plan documents live at:

    plans/yyyymmdd-short-description/

- `yyyymmdd` — today's date, stamped automatically so the date never drifts or gets typed wrong.
- `short-description` — a short, kebab-case summary of the topic (lowercase, words joined by hyphens). Keep it to a few words that capture the essence.

Example: a plan about refreshing OAuth tokens → `plans/20260615-token-refresh/`. The plan file itself is then written as `plan.md` inside that directory.

## How to create it

Run the bundled script, passing a short description of the topic. The script slugifies the text and stamps today's date, so you can pass natural phrasing — pick a concise summary rather than the user's whole sentence (e.g. pass `"OAuth token refresh"`, not `"I want to plan how we refresh OAuth tokens before they expire"`).

```bash
bash "$HOME/.claude/skills/create-plan-dir/scripts/create_plan_dir.sh" "OAuth token refresh"
```

The script prints the created directory path (e.g. `plans/20260615-oauth-token-refresh/`) to stdout and creates it with `mkdir -p`, so re-running is harmless. Use the printed path for whatever comes next — typically writing `plan.md` inside it.

If running the script isn't possible in the current environment, fall back to creating the directory by hand: take today's date as `yyyymmdd`, slugify the topic to lowercase hyphen-separated words, and create `plans/<yyyymmdd>-<slug>/`.
