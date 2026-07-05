#!/usr/bin/env bash
# Create a date-stamped plan directory following the project convention:
#   plans/<yyyymmdd>-<slug>/          (projects that commit plans to source control)
#   .nocommit/plans/<yyyymmdd>-<slug>/ (projects that don't have a plans/ dir)
#
# Usage: create_plan_dir.sh "<short topic description>"
#
# The argument is a short, human-readable summary of the plan topic. It is
# slugified (lowercased, non-alphanumeric runs collapsed to single hyphens)
# so callers can pass natural phrasing and still get a clean directory name.
# Today's date is stamped automatically so the convention has one source of
# truth and never drifts. The created directory path is printed to stdout for
# the caller to use (e.g. to write plan.md inside it).
set -euo pipefail

raw="${1:-}"
if [ -z "$raw" ]; then
  echo "error: provide a short description of the plan topic" >&2
  exit 1
fi

# Slugify: lowercase, collapse any run of non-alphanumeric chars to one hyphen,
# then trim leading/trailing hyphens.
slug=$(printf '%s' "$raw" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')

if [ -z "$slug" ]; then
  echo "error: '$raw' did not yield a usable slug" >&2
  exit 1
fi

date_stamp=$(date +%Y%m%d)

# Projects that commit their plans to source control already have a plans/
# directory; reuse it. Otherwise, keep plans out of source control under
# .nocommit/plans/ (gitignored — see .gitignore).
if [ -d "plans" ]; then
  base="plans"
else
  base=".nocommit/plans"
fi

dir="${base}/${date_stamp}-${slug}"
mkdir -p "$dir"
printf '%s\n' "$dir"
