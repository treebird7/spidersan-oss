#!/usr/bin/env bash
# Fixture harness for same-file-warn.sh: two simulated Claude sessions in one checkout.
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../hooks" && pwd)"
H="$HERE/same-file-warn.sh"
PASS=0; FAIL=0
ok(){ if echo "$2" | grep -qF "$3"; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1"; echo "     got: $2"; FAIL=$((FAIL+1)); fi; }
silent(){ if [ -z "$2" ]; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1 (expected silence)"; echo "     got: $2"; FAIL=$((FAIL+1)); fi; }

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo dir/src" "$T/home" "$T/ids"; cd "$T/repo dir"
# Per-session identity files, as the plugin reads them (spidersan-identity.sh).
export SPIDERSAN_IDENTITY_FILE="$T/ids/{session_id}.env" SPIDERSAN_IDENTITY_KEY=AGENT
export SPIDERSAN_SESSION_HINT="sessions watch {session_id}"
git init -q; git config user.email t@t.t; git config user.name t
echo a > src/a.ts; echo b > b.ts; git add .; git commit -qm init
echo 'AGENT=reviewer' > "$T/ids/sess-AAAA-1111.env"

# write <session> <file>: one PostToolUse payload, as Claude Code sends it
write(){ jq -n --arg s "$1" --arg f "$2" '{session_id:$s,tool_name:"Edit",tool_input:{file_path:$f}}' \
    | HOME="$T/home" SPIDERSAN_AGENT= bash "$H"; }

echo "═══ two sessions, one checkout ═══"
silent "first writer -> silent"            "$(write sess-AAAA-1111 "$T/repo dir/src/a.ts")"
silent "same session again -> silent"      "$(write sess-AAAA-1111 "$T/repo dir/src/a.ts")"
out=$(write sess-BBBB-2222 "$T/repo dir/src/a.ts")
ok "second session -> warns"               "$out" "src/a.ts was also written"
ok "names the other agent"                 "$out" "by reviewer (session sess-AAA)"
silent "warns only once per pair"          "$(write sess-BBBB-2222 "$T/repo dir/src/a.ts")"
out=$(write sess-AAAA-1111 "$T/repo dir/src/a.ts")
ok "first session hears back too"          "$out" "by unknown agent (session sess-BBB)"
silent "different file -> silent"          "$(write sess-BBBB-2222 "$T/repo dir/b.ts")"

echo "═══ silence cases ═══"
git worktree add -q "$T/sibling" -b other
silent "sibling worktree, same path -> silent" "$(write sess-CCCC-3333 "$T/sibling/src/a.ts")"
printf '%s\tsess-OLD-0000\told\tb.ts\n' "$(( $(date +%s) - 4000 ))" >> "$(git rev-parse --absolute-git-dir)/claude-writes"
silent "write outside window -> silent"    "$(write sess-DDDD-4444 "$T/repo dir/b.ts" | grep 'sess-OLD' || true)"
mkdir "$T/norepo"; echo x > "$T/norepo/x"
silent "not a git repo -> silent"          "$(write sess-AAAA-1111 "$T/norepo/x")"
silent "no session_id -> silent"           "$(echo '{"tool_input":{"file_path":"/tmp/x"}}' | bash "$H")"
silent "garbage payload -> silent"         "$(echo 'not json' | bash "$H")"

echo "═══ shell writes (PreToolUse + PostToolUse on Bash) ═══"
R="$T/repo dir"; cd "$R"
echo c > src/c.ts; echo d > d.ts; echo e > e.ts; git add .; git commit -qm more
# hook <event> <session> <tool_use_id> <cwd>: one Bash hook payload
hook(){ jq -n --arg e "$1" --arg s "$2" --arg t "$3" --arg c "$4" \
    '{hook_event_name:$e,tool_name:"Bash",session_id:$s,tool_use_id:$t,cwd:$c,tool_input:{command:"x"}}' \
    | HOME="$T/home" SPIDERSAN_AGENT= bash "$H"; }
# bashrun <session> <tool_use_id> <cwd> <command…>: Pre hook, the command, Post hook (prints Post's output)
bashrun(){ local s=$1 t=$2 c=$3; shift 3; hook PreToolUse "$s" "$t" "$c" >/dev/null; (cd "$c" && eval "$*"); hook PostToolUse "$s" "$t" "$c"; }
LOG="$(git rev-parse --absolute-git-dir)/claude-writes"

write sess-AAAA-1111 "$R/src/c.ts" >/dev/null
out=$(bashrun sess-BBBB-2222 t1 "$R" "perl -pi -e 's/c/C/' src/c.ts")
ok "perl -pi after another session's Edit -> warns" "$out" "src/c.ts was also written"
ok "names the Edit-side agent"                     "$out" "by reviewer (session sess-AAA)"

silent "cat > new untracked file -> silent"        "$(bashrun sess-BBBB-2222 t2 "$R" "echo new > n.ts")"
ok "...and is logged: an Edit of it then warns"    "$(write sess-AAAA-1111 "$R/n.ts")" "n.ts was also written"

echo changed > d.ts; write sess-AAAA-1111 "$R/d.ts" >/dev/null
out=$(bashrun sess-CCCC-3333 t3 "$R" "git stash -q")
ok "git stash reverting another session's edit -> warns" "$out" "d.ts was also written"
git stash pop -q

silent "read-only command -> silent"               "$(bashrun sess-CCCC-3333 t4 "$R" "ls >/dev/null")"
silent "snapshot files cleaned up"                 "$(ls "$(git rev-parse --absolute-git-dir)" | grep claude-snap || true)"

out=$(bashrun sess-DDDD-4444 t5 "$R" "echo x >> e.ts; write sess-AAAA-1111 '$R/e.ts' >/dev/null")
ok "other session writes DURING my command -> still warns" "$out" "e.ts was also written"
silent "...but the write is not booked to me"      "$(awk -F'\t' '$2=="sess-DDDD-4444" && $4=="e.ts"' "$LOG")"
ok "(log is readable — the check above can fail)"  "$(awk -F'\t' '$4=="e.ts" {print $2}' "$LOG")" "sess-AAAA-1111"

silent "Bash outside a git repo -> silent"         "$(bashrun sess-BBBB-2222 t6 "$T/norepo" "echo y > x")"
silent "Post without Pre -> silent"                "$(hook PostToolUse sess-BBBB-2222 t-none "$R")"

echo "═══ v1.2: a commit that would sweep up another session's files ═══"
# Fresh checkout: OWNER works there; INTRUDER cds in from its own checkout and writes.
O="$T/owner wt"; I="$T/intruder"; mkdir -p "$O" "$I"
for r in "$O" "$I"; do (cd "$r" && git init -q && git config user.email t@t.t && git config user.name t \
    && echo o > own.md && echo s > shared.md && echo x > x.md && git add . \
    && GIT_COMMITTER_DATE="@$(( $(date +%s) - 600 )) +0000" git commit -qm init); done
# Backdated: the guard treats a write in the SAME second as the file's last commit as committed,
# and on a fast runner the init commit and a later write share a second.
echo 'AGENT=intruder' > "$T/ids/sess-INTR-0002.env"
echo 'AGENT=owner' > "$T/ids/sess-OWNR-0001.env"
# cmdhook <session> <tool_use_id> <cwd> <command>: a PreToolUse(Bash) payload carrying the command text
cmdhook(){ jq -n --arg s "$1" --arg t "$2" --arg c "$3" --arg k "$4" \
    '{hook_event_name:"PreToolUse",tool_name:"Bash",session_id:$s,tool_use_id:$t,cwd:$c,tool_input:{command:$k}}' \
    | HOME="$T/home" SPIDERSAN_AGENT= bash "$H"; }
echo o2 > "$O/own.md"; write sess-OWNR-0001 "$O/own.md" >/dev/null
echo s2 > "$O/shared.md"; write sess-OWNR-0001 "$O/shared.md" >/dev/null

silent "(b) first Bash call of a session -> silent"   "$(cmdhook sess-INTR-0002 v1 "$I" "ls")"
out=$(cmdhook sess-INTR-0002 v2 "$O" "cd '$O'")
ok "(b) cwd moves into a checkout with another session's writes -> warns" "$out" "You just moved into"
ok "(b) ...names that session"                       "$out" "owner (session sess-OWN"
silent "(b) same checkout again -> silent"            "$(cmdhook sess-INTR-0002 v3 "$O" "ls")"

echo i > "$O/new-pattern.md"
out=$(write sess-INTR-0002 "$O/new-pattern.md")
ok "(c) write to a file only I touched, in a shared checkout -> warns" "$out" "wrote 2 file(s) in this checkout"
ok "(c) ...with the configured session hint"         "$out" "sessions watch sess-OWNR-0001"
silent "(c) once per checkout"                        "$(echo j > "$O/p2.md"; write sess-INTR-0002 "$O/p2.md")"

out=$(cd "$O" && git add -A && cmdhook sess-OWNR-0001 c1 "$O" "git commit -m 'my 5 lessons'")
ok "(a) commit sweeping another session's files -> denied" "$out" '"permissionDecision": "deny"'
ok "(a) ...lists the file only the intruder wrote"   "$out" "new-pattern.md — intruder"
ok "(a) ...says how to reach that session"           "$out" "sessions watch sess-INTR-0002"
no(){ if echo "$2" | grep -qF "$3"; then echo "  ❌ $1 (unexpected: $3)"; FAIL=$((FAIL+1)); else echo "  ✅ $1"; PASS=$((PASS+1)); fi; }
no "(a) ...not the owner's own file"                 "$out" "own.md"
(cd "$O" && git reset -q)
out=$(cmdhook sess-OWNR-0001 c2 "$O" "git add -A && git commit -m all")
ok "(a) 'git add -A && git commit' in one command -> denied" "$out" "new-pattern.md"
silent "(a) scoped 'git add own.md && git commit' -> allowed" "$(cmdhook sess-OWNR-0001 c2b "$O" "git add own.md && git commit -m mine")"
ok "(a) 'git add new-pattern.md && git commit' -> denied" "$(cmdhook sess-OWNR-0001 c2c "$O" "git add 'new-pattern.md' && git commit -m x")" "new-pattern.md"
ok "(a) 'cd <their checkout> && git add -A && git commit' from elsewhere -> denied" \
    "$(cmdhook sess-OWNR-0001 c2d "$I" "cd '$O' && git add -A && git commit -m x")" "new-pattern.md"
out=$(cmdhook sess-OWNR-0001 c2e "$I" "git -C '$O' commit -am x")
silent "(a) 'commit -a' ignores untracked files (it never commits them)" "$out"
echo x2 > "$O/x.md"; write sess-INTR-0002 "$O/x.md" >/dev/null
ok "(a) 'git -C <checkout> commit -am' from elsewhere -> denied on their tracked edit" \
    "$(cmdhook sess-OWNR-0001 c2e2 "$I" "git -C '$O' commit -am x")" "x.md — intruder"
ok "(a) cwd not a repo at all, 'cd <checkout> && …commit' -> denied" \
    "$(cmdhook sess-OWNR-0001 c2f "$T/norepo" "cd '$O' && git add -A && git commit -m x")" "new-pattern.md"
silent "(a) 'cd <clean checkout> && git commit' -> allowed" \
    "$(cmdhook sess-OWNR-0001 c2g "$O" "cd '$I' && git add -A && git commit -m x")"
rm -f "$(cd "$I" && git rev-parse --absolute-git-dir)"/claude-snap.*
cmdhook sess-OWNR-0001 c2h "$O" "ls" >/dev/null   # back in $O: (b) has already warned for this move
(cd "$O" && git add own.md)
silent "(a) committing only my own file -> allowed"   "$(cmdhook sess-OWNR-0001 c3 "$O" "git commit -m mine")"
(cd "$O" && git add -A)
silent "(a) SAME_FILE_OK=1 override -> allowed"       "$(cmdhook sess-OWNR-0001 c4 "$O" "SAME_FILE_OK=1 git commit -m both")"
(cd "$O" && git commit -qm both)
echo k > "$O/new-pattern.md"; (cd "$O" && git add -A)
silent "(a) their write is already committed -> allowed" "$(cmdhook sess-OWNR-0001 c5 "$O" "git commit -m later")"
rm -f "$(cd "$O" && git rev-parse --absolute-git-dir)"/claude-snap.*

echo "═══ stale <sid>.root files are pruned ═══"
ST="$T/home/.claude/state/same-file-warn"
echo "$O" > "$ST/sess-OLD-0009.root"; touch -t 202001010000 "$ST/sess-OLD-0009.root"
echo "$O" > "$ST/sess-RCNT-0008.root"
cmdhook sess-NEW-0007 p1 "$O" "ls" >/dev/null   # a new session's first Bash call
ok "a .root older than 30 days is deleted" "$([ -e "$ST/sess-OLD-0009.root" ] && echo kept || echo gone)" "gone"
ok "a recent .root is kept"                "$([ -e "$ST/sess-RCNT-0008.root" ] && echo kept || echo gone)" "kept"
ok "the new session's own .root is written" "$([ -e "$ST/sess-NEW-0007.root" ] && echo kept || echo gone)" "kept"

echo "═══ no SPIDERSAN_SESSION_HINT: the full session id instead ═══"
N="$T/nohint"; mkdir -p "$N"; (cd "$N" && git init -q && git config user.email t@t.t && git config user.name t \
    && echo n > n.md && git add . && GIT_COMMITTER_DATE="@$(( $(date +%s) - 600 )) +0000" git commit -qm init)
echo n1 > "$N/n.md"; write sess-OWNR-0001 "$N/n.md" >/dev/null
echo n2 > "$N/m.md"
out=$(SPIDERSAN_SESSION_HINT= write sess-INTR-0002 "$N/m.md")
ok "names the full session id to reach"   "$out" "session sess-OWNR-0001"
no "...and no hint command"               "$out" "sessions watch"

echo; echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
