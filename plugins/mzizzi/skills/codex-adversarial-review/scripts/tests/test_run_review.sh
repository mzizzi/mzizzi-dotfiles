#!/usr/bin/env bash
# Regression checks for run_review.sh's failure contract: the underlying script's
# exit status must propagate, stdout must be released only on success, and stderr
# must surface only on failure.
#
# Scripted rather than eyeballed because the status-capture line is the most
# defect-prone part of the wrapper: `if ! node …` makes $? the negated status,
# which turns every failure into a silent success.
#
# Usage: bash test_run_review.sh     (exits non-zero if any case fails)
set -u

script="$(cd "$(dirname "$0")/.." && pwd)/run_review.sh"
work=$(mktemp -d "${TMPDIR:-/tmp}/crtest.XXXXXX")   # templated for BSD/macOS mktemp
trap 'rm -rf "$work"' EXIT

# A fake HOME so plugin resolution succeeds and the run reaches the part under test.
fake_home="$work/home"
mkdir -p "$fake_home/.claude/plugins" "$fake_home/plug/scripts" "$work/bin"
touch "$fake_home/plug/scripts/codex-companion.mjs"
printf '{"plugins":{"codex@openai-codex":[{"installPath":"%s"}]}}\n' \
  "$fake_home/plug" > "$fake_home/.claude/plugins/installed_plugins.json"

fails=0
for code in 0 1 2 7; do
  # The stub writes to stdout *before* failing, mimicking the companion
  # rendering a partial report and only then settling on a non-zero status.
  cat > "$work/bin/node" <<EOF
#!/usr/bin/env bash
echo "REPORT BODY (stub exit $code)"
echo "stub diagnostic for exit $code" >&2
exit $code
EOF
  chmod +x "$work/bin/node"

  out=$(PATH="$work/bin:$PATH" HOME="$fake_home" bash "$script" "--scope auto test" 2>"$work/err")
  got=$?
  err=$(cat "$work/err")

  if [ "$code" -eq 0 ]; then
    want_out="REPORT BODY (stub exit 0)"; want_err=""
  else
    want_out=""; want_err="stub diagnostic for exit $code"
  fi

  ok=yes
  [ "$got" = "$code" ]      || ok=no
  [ "$out" = "$want_out" ]  || ok=no
  [ "$err" = "$want_err" ]  || ok=no
  [ "$ok" = yes ] || fails=$((fails + 1))

  printf 'underlying exit %-2s -> wrapper %-2s  stdout=%-9s stderr=%-9s [%s]\n' \
    "$code" "$got" \
    "$(if [ -n "$out" ]; then echo nonempty; else echo empty; fi)" \
    "$(if [ -n "$err" ]; then echo nonempty; else echo empty; fi)" \
    "$ok"
done

echo
if [ "$fails" -eq 0 ]; then echo "PASS"; else echo "FAIL: $fails case(s)"; exit 1; fi
