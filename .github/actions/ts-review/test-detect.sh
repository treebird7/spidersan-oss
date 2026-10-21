#!/usr/bin/env bash
# Runs the "Detect changed TS files" step of action.yml against a local fixture repo,
# cloned shallow the way actions/checkout does. Guards the 2026-10-19 bug: a base
# commit missing from the clone made the diff fail silently, so the job reported
# "Found 0 TS file(s)" and passed. No network. Usage: bash test-detect.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
fail=0

# The step's run: block, dedented, exactly as the action would run it.
python3 - "$HERE/action.yml" "$T/step.sh" <<'EOF'
import sys
s = open(sys.argv[1]).read()
i = s.index("      run: |\n", s.index("- name: Detect changed TS files")) + len("      run: |\n")
blk = s[i:s.index("    - name:", i)]
open(sys.argv[2], "w").write("\n".join(l[8:] for l in blk.rstrip().split("\n")) + "\n")
EOF

# main: a.ts, b.ts | feat (from b.ts): x.ts, y.d.ts + z.js, w.ts | main then adds m.ts
g() { git -C "$T/work" -c user.name=t -c user.email=t@t "$@"; }
commit() { touch "$T/work/$1"; g add -A; g commit -qm "$1"; g rev-parse HEAD; }
git init -q -b main "$T/work"
commit a.ts >/dev/null; commit b.ts >/dev/null
g checkout -qb feat
F1=$(commit x.ts); touch "$T/work/z.js"; commit y.d.ts >/dev/null; F3=$(commit w.ts)
g checkout -q main; M=$(commit m.ts)
git clone -q --bare "$T/work" "$T/origin.git"
git -C "$T/origin.git" config uploadpack.allowAnySHA1InWant true

# check <name> <want-exit 0|1> <want-files> VAR=value...
check() {
  local name=$1 want_rc=$2 want=$3; shift 3
  rm -rf "$T/c"; git clone -q --depth 2 --branch feat "file://$T/origin.git" "$T/c"
  : > "$T/out"
  local rc=0
  (cd "$T/c" && env GITHUB_OUTPUT="$T/out" INPUT_FILES= BEFORE_SHA= PR_BASE_SHA= \
     AFTER_SHA="$F3" DEFAULT_BRANCH=main "$@" bash "$T/step.sh") >"$T/log" 2>&1 || rc=$?
  local got; got=$(paste -sd, /tmp/ts_files.txt 2>/dev/null || true)
  if [[ $want_rc == 0 && $rc == 0 && "$got" == "$want" ]] && grep -qx "count=$(awk -F, '{print NF}' <<<"$want")" "$T/out"; then
    echo "ok   $name: $got"
  elif [[ $want_rc == 1 && $rc != 0 ]] && ! grep -q '^count=' "$T/out"; then
    echo "ok   $name: failed as expected (exit $rc), no count reported"
  else
    echo "FAIL $name: exit $rc, files '$got' (want '$want'), output: $(cat "$T/out")"; sed 's/^/     /' "$T/log"; fail=1
  fi
  rm -f /tmp/ts_files.txt /tmp/ts_all.txt
}

check "multi-commit push, before outside the shallow clone" 0 "w.ts" BEFORE_SHA="$F1"
check "first push of a branch"            0 "w.ts,x.ts" BEFORE_SHA=0000000000000000000000000000000000000000
check "force push, before unreachable"    0 "w.ts,x.ts" BEFORE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
check "pull_request, base not in clone"   0 "w.ts,x.ts" PR_BASE_SHA="$M"
check "files input bypasses git"          0 "p.ts,q.ts" INPUT_FILES=$'p.ts\nq.ts'
check "no base can be found: must fail"   1 ""          DEFAULT_BRANCH=nosuchbranch
exit $fail
