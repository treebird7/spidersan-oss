#!/usr/bin/env bash
# Fixture harness for spidersan-worktree-guard.sh: another agent's dirty branch,
# a fresh SessionStart with no identity, a per-session identity file, and each
# silence case.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../hooks" && pwd)"
G="$HERE/spidersan-worktree-guard.sh"
PASS=0; FAIL=0
ok(){ if echo "$2" | grep -qF "$3"; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1"; echo "     got: $2"; FAIL=$((FAIL+1)); fi; }
no(){ if echo "$2" | grep -qF "$3"; then echo "  ❌ $1 (unexpected: $3)"; FAIL=$((FAIL+1)); else echo "  ✅ $1"; PASS=$((PASS+1)); fi; }
silent(){ if [ -z "$2" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1 (expected silence)"; echo "     got: $2"; FAIL=$((FAIL+1)); fi; }

# A space in the path — Claude Code really does run in dirs like
# "Library/Application Support/Claude", and v1.0's `read` split on it.
T="/tmp/test wt guard"; rm -rf "$T"; mkdir -p "$T"; cd "$T"
git init -q; git config user.email t@t.t; git config user.name t
echo a > a.txt; git add .; git commit -qm init

pl(){ python3 -c "import json,sys; print(json.dumps({'cwd':sys.argv[1],'session_id':'none'}))" "$T"; }
# known-identity run
run(){ pl | SPIDERSAN_AGENT="$1" SPIDERSAN_IDENTITY_FILE= bash "$G"; }
# a fresh SessionStart: no identity configured at all
cold(){ pl | SPIDERSAN_AGENT= SPIDERSAN_IDENTITY_FILE= bash "$G"; }
# identity from a per-session file (session_id 'none' in the payload)
IDS="$T/ids"; mkdir -p "$IDS"; echo 'AGENT=builder' > "$IDS/none.env"
byfile(){ pl | SPIDERSAN_AGENT= SPIDERSAN_IDENTITY_FILE="$IDS/{session_id}.env" SPIDERSAN_IDENTITY_KEY=AGENT bash "$G"; }

echo "═══ another agent's dirty branch ═══"
git checkout -qb builder2/cleanup-sweep; echo dirty > a.txt
out=$(run tester); ok "someone else's dirty branch -> warns" "$out" "is not your handle"
ok "names the branch" "$out" "builder2/cleanup-sweep"
ok "counts the files" "$out" "1 uncommitted file"
ok "path with a space survives" "$out" "/tmp/test wt guard"

echo "═══ fresh SessionStart, no identity configured ═══"
out=$(cold); ok "cold start on a dirty tree -> neutral warn" "$out" "none of it is this session's work"
no "names no handle" "$out" "your handle ('"
git checkout -q -- a.txt
out=$(cold); silent "cold start on a CLEAN tree -> silent" "$out"

echo "═══ silence cases (identity known) ═══"
git checkout -qb builder2/again 2>/dev/null; echo dirty > a.txt
out=$(run builder);    silent "my own handle prefix" "$out"
out=$(run builder-host2); silent "suffixed handle matches its base" "$out"
out=$(byfile);        silent "handle from the per-session identity file" "$out"
out=$(pl | SPIDERSAN_AGENT=tester SPIDERSAN_IDENTITY_FILE="$IDS/{session_id}.env" SPIDERSAN_IDENTITY_KEY=AGENT bash "$G")
silent "the identity file wins over SPIDERSAN_AGENT" "$out"
git checkout -qb feat/whatever
out=$(run tester);     silent "conventional prefix (feat/)" "$out"
git checkout -qb tester2/mine
out=$(run tester);     silent "my numbered instance" "$out"
git checkout -q -- a.txt
git checkout -qb builder2/third; echo d > a.txt
out=$(run tester); ok "sanity: still warns before the clean check" "$out" "not your handle"
git checkout -q -- a.txt
out=$(run tester);     silent "clean tree" "$out"
echo untracked > junk.txt
out=$(run tester);     silent "untracked-only is not someone's WIP" "$out"
rm -f junk.txt
git checkout -qb bareb 2>/dev/null; echo dirty > a.txt
out=$(run tester);     silent "branch with no prefix -> no ownership signal" "$out"
out=$(python3 -c "import json;print(json.dumps({'cwd':'/tmp','session_id':'none'}))" | SPIDERSAN_AGENT=tester bash "$G")
silent "not a git repo" "$out"

echo; echo "  $PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
