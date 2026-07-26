#!/usr/bin/env bash
# Derive the feature-branch name for a plan and report the git state needed to
# decide between reusing existing feature work and creating it fresh.
#
# Reports; never mutates. The caller performs the switch/create, because
# entering a worktree is a harness tool call rather than a shell command.
#
# Usage: inspect_branch_state.sh <plan-directory-or-plan-file>
set -uo pipefail

target="${1:-}"
if [ -z "$target" ]; then
  echo "usage: inspect_branch_state.sh <plan-directory-or-plan-file>" >&2
  exit 2
fi

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "ERROR=not-a-git-repository"
  exit 1
fi

# A plan file resolves to the directory holding it; the directory names the branch.
# Requiring the path to exist keeps a typo from silently yielding a branch named
# after the typo (a plan file that isn't there would otherwise become the slug).
if [ -d "$target" ]; then
  plan_dir="$target"
elif [ -f "$target" ]; then
  plan_dir="$(dirname "$target")"
else
  echo "ERROR=no-such-path"
  exit 1
fi
slug="$(basename "$plan_dir")"
slug="${slug#[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-}"   # strip the yyyymmdd- stamp

email="$(git config user.email || true)"
username="${email%%@*}"
if [ -z "$username" ]; then
  echo "ERROR=no-git-user-email"
  exit 1
fi

branch="${username}/${slug}"

# origin wins when present: `git remote` sorts alphabetically, so a repo with
# both `fork` and `origin` would otherwise branch off the fork.
if git remote | grep -qx origin; then
  remote="origin"
else
  remote="$(git remote | head -n 1)"
fi
if [ -n "$remote" ] && trunk_ref="$(git symbolic-ref --short "refs/remotes/${remote}/HEAD" 2>/dev/null)"; then
  trunk="${trunk_ref#"${remote}"/}"
elif git show-ref --verify --quiet refs/heads/main; then
  trunk="main"
else
  trunk="master"
fi

current="$(git rev-parse --abbrev-ref HEAD)"
dirty="no"
[ -n "$(git status --porcelain)" ] && dirty="yes"

branch_exists="no"
git show-ref --verify --quiet "refs/heads/${branch}" && branch_exists="yes"

# git worktree list --porcelain emits stanzas: worktree <path> / HEAD <sha> / branch <ref>
worktree_path="$(git worktree list --porcelain | awk -v b="refs/heads/${branch}" '
  /^worktree /{ path = substr($0, 10) }
  $0 == "branch " b { print path; exit }
')"

if [ "$dirty" = "yes" ]; then
  action="abort-dirty-tree"
elif [ "$current" = "$branch" ]; then
  action="stay"
elif [ -n "$worktree_path" ]; then
  action="enter-worktree"
elif [ "$branch_exists" = "yes" ]; then
  action="switch"
elif [ "$current" != "$trunk" ]; then
  # Sitting on some other non-trunk branch: it may be hand-named feature work for
  # this same plan, which the caller should reuse rather than fork a second branch
  # from. Only the caller can tell — surfaced as its own action so the question
  # can't be read past.
  action="judge-current-branch-then-create"
else
  action="create"
fi

cat <<EOF
BRANCH=${branch}
SLUG=${slug}
USERNAME=${username}
TRUNK=${trunk}
REMOTE=${remote}
CURRENT_BRANCH=${current}
DIRTY=${dirty}
BRANCH_EXISTS=${branch_exists}
WORKTREE_PATH=${worktree_path}
ACTION=${action}
EOF
