---
name: pr
description: "Create and manage pull requests, branches, and commits with the gh CLI and git, following this user's PR conventions. Use for opening a PR, viewing PR details or checks, or committing and pushing work."
allowed-tools:
  - Bash(gh pr list*)
  - Bash(gh pr view*)
  - Bash(gh pr status*)
  - Bash(gh pr diff*)
  - Bash(gh pr checks*)
  - Bash(gh pr create*)
  - Bash(gh issue list*)
  - Bash(gh issue view*)
  - Bash(gh repo view*)
  - Bash(git log*)
  - Bash(git status*)
  - Bash(git branch*)
  - Bash(git fetch*)
  - Bash(git remote*)
  - Bash(git checkout -b*)
  - Bash(git add*)
  - Bash(git commit*)
  - Bash(git push*)
disable-model-invocation: false
user-invocable: true
---

# Instructions

You can use the GitHub CLI (`gh`) and Git commands to access repository information.

## IMPORTANT: Safety rules that must always be respected

**NEVER push directly to master or main branches without explicit user permission.**

- Always create a feature branch for changes
- The default workflow is: feature branch → pull request → review → merge

**NEVER perform destructive Git operations that could cause data loss:**

- NO force pushes (`git push --force` or `git push -f`) without explicit user permission
- NO hard resets that discard commits (`git reset --hard`)
- NO branch deletions
- NO history rewriting operations (`git rebase -i`, `git commit --amend` on pushed commits, etc.)
- NO operations that could overwrite or lose committed work

If the user requests a potentially destructive operation, deny it and ask the user to preform the task manually.

## Viewing Pull Requests

Use these commands to view and check pull requests:

- `gh pr list` - List all pull requests
- `gh pr view [number]` - View details of a specific PR
- `gh pr status` - Check the status of PRs
- `gh pr diff [number]` - View the diff of a PR
- `gh pr view [number] --comments` - Read PR comments
- `gh pr checks [number]` - Check PR CI/CD status

## Opening a Pull Request

Follow this process when creating a new pull request:

1. **Ensure branch is based on latest main/master:**
   - Run `git fetch origin` to get the latest remote state
   - Determine the default branch name (main or master) via `git remote show origin | grep 'HEAD branch'`
   - Create the new branch from the latest remote default branch: `git checkout -b <descriptive-branch-name> origin/<default-branch>`
   - This ensures the feature branch is never based on a stale local copy

2. **Stage specific files:**
   - Use `git add <file1> <directory1>...` to add ONLY the specific files and directories needed for the PR
   - Never add extra files or files containing sensitive information (secrets, credentials, .env files, etc.)
   - Use `git status` to verify what will be committed

3. **Commit changes:**
   - Write short, concise commit messages (1-2 sentences maximum)
   - Let the PR body contain detailed descriptions, not the commit message
   - Example: `git commit -m "Add user authentication feature"`

4. **Push to remote:**
   - Use `git push -u origin <branch-name>` to push and set upstream tracking

5. **Create pull request:**
   - Use `gh pr create` to open a new pull request
   - **PR descriptions should be minimal** - include only the essential information needed for review
     - Avoid colorful language in reviews
     - Avoid robotic language, executive like language, and hyperbole
     - Never use em dashes (—). Use a hyphen, a comma, or restructure the sentence instead.
     - PR descriptions are for software engineers and should be tailored for that audience
     - Avoid bombarding potential reviewers with too much information
     - Include the relevant information for human code review
     - Never include attribution to claude code, claude sessions, or anything anthropic related
   - Humans review PRs and their time is valuable - no extra or fabricated information
   - **Create as draft by default** unless the user explicitly specifies otherwise
   - If the prompt references a specific template format then use that instead of the **Default PR Template** below.
   - Example: `gh pr create --draft --title "Add authentication" --body "$(cat <<'EOF' ... EOF)"`

## Default PR Template

Use this template when the repository does not provide its own PR template:

```
Concise, high level, description of the changes made and the **why** of the PR goes here. Less is more. This is meant to quickly orient a human reviewer. LESS IS MORE.

## Related

bulleted list of links to related PRs, GitHub issues, Linear issues (if applicable), etc

## Detail

IMPORTANT: Less is more. Prefer omitting this section altogether if the guidelines below would lead to an empty/weak details section. LESS IS MORE.

* GOOD DETAILS:
  * Focus on the approach, motivation, and anything non-obvious to orient a human reviewer
* BAD DETAILS, DO NOT:
  * Rehash trivial details that a reader would know from the diff
  * repeat information from other sections in the document
  * count things ("adds 5 parameters", "modifies 3 files"), enumerate lists of names
  * narrate the structure of the diff ("before X, adds a block that calls Y")

NO ATTRIBUTION TO CLAUDE CODE, CLAUDE SESSIONS, OR ANYTHING ANTHROPIC RELATED.
```

Keep each section concise. Omit a section if it adds no value (e.g. "Why" is obvious from the title, or "How" would just repeat the diff). The goal is to give reviewers enough context to review efficiently, not to document everything.

## Branch Operations

- `git checkout -b <branch-name>` - Create and switch to a new branch
- `git branch` - List branches or check current branch
