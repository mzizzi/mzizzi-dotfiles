#!/usr/bin/env bash
# Derive the feature-branch name for a plan and report the git state needed to
# decide between reusing existing feature work and creating it fresh.
#
# Reports; never touches the working tree or local branches. The caller performs
# the switch/create, because entering a worktree is a harness tool call rather
# than a shell command. It does fetch when it needs to compare the trunk against
# its remote, which only moves remote-tracking refs.
#
# Usage: inspect_branch_state.sh <plan-directory-or-plan-file>
set -uo pipefail

OTHER_LIST_CAP=20   # how many pending-edit lines to echo before summarizing the rest

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

# Uncommitted changes are split in two: the plan directory this run is about, and
# everything else. The dominant flow is create-plan straight into implement-plan,
# so the plan document is routinely untracked at this point — its own output is
# not an obstacle to route around, and only the caller's real edits should abort.
# Porcelain paths are relative to the repo root, and --show-prefix reports the
# plan directory the same way. Subtracting --show-toplevel from `pwd` would not:
# under Git Bash the two disagree on path form (`C:/x` vs `/c/x`).
plan_rel="$(cd "$plan_dir" && git rev-parse --show-prefix)"
plan_rel="${plan_rel%/}"
plan_dirt="no"
other_dirt="no"
other_count=0
other_entries=""
# --untracked-files=all because the default collapses an untracked directory to its
# shallowest path: the first plan in a project reports as `?? plans/`, which matches
# no plan directory and would be read as somebody's unrelated work.
while IFS= read -r entry; do
  [ -z "$entry" ] && continue
  path="${entry:3}"   # porcelain status codes occupy the first three columns
  case "$path" in
    "$plan_rel" | "$plan_rel"/*) plan_dirt="yes" ;;
    *)
      other_dirt="yes"
      other_count=$((other_count + 1))
      # Verbatim porcelain lines, so the caller can put the decision to the user
      # without a follow-up `git status`. Capped: a formatter run over the tree
      # would otherwise push hundreds of lines into the caller's context.
      [ "$other_count" -le "$OTHER_LIST_CAP" ] && other_entries="${other_entries}${entry}"$'\n'
      ;;
  esac
done < <(git status --porcelain --untracked-files=all)

branch_exists="no"
git show-ref --verify --quiet "refs/heads/${branch}" && branch_exists="yes"

# git worktree list --porcelain emits stanzas: worktree <path> / HEAD <sha> / branch <ref>
worktree_path="$(git worktree list --porcelain | awk -v b="refs/heads/${branch}" '
  /^worktree /{ path = substr($0, 10) }
  $0 == "branch " b { print path; exit }
')"

# Pending edits are reported, not routed on: where the branch should come from and
# what to do with somebody's work in progress are independent questions, and folding
# the second into ACTION meant a dirty tree suppressed the branch routing the caller
# still needs once the user has resolved it.
if [ "$current" = "$branch" ]; then
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

# Only a fresh branch has a base to get wrong, so the staleness check — and the
# fetch it costs — is confined to the two actions that can end in one. This user
# pushes at session end, so a local trunk behind its remote is the normal state.
trunk_behind=0
case "$action" in
  create | judge-current-branch-then-create)
    if [ -n "$remote" ]; then
      git fetch --quiet "$remote" "$trunk" 2>/dev/null
      trunk_behind="$(git rev-list --count "refs/heads/${trunk}..${remote}/${trunk}" 2>/dev/null || echo 0)"
    fi
    ;;
esac

cat <<EOF
BRANCH=${branch}
SLUG=${slug}
USERNAME=${username}
TRUNK=${trunk}
REMOTE=${remote}
CURRENT_BRANCH=${current}
PLAN_DIR_DIRTY=${plan_dirt}
OTHER_DIRTY=${other_dirt}
OTHER_DIRTY_COUNT=${other_count}
TRUNK_BEHIND=${trunk_behind}
BRANCH_EXISTS=${branch_exists}
WORKTREE_PATH=${worktree_path}
ACTION=${action}
EOF

if [ "$other_dirt" = "yes" ]; then
  echo "--- pending edits outside the plan directory ---"
  printf '%s' "$other_entries"
  # An `[ ... ] && echo` here would make a false test the script's exit status.
  if [ "$other_count" -gt "$OTHER_LIST_CAP" ]; then
    echo "... and $((other_count - OTHER_LIST_CAP)) more"
  fi
fi
