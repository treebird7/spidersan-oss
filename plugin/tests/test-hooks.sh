#!/usr/bin/env bash
# Fixture harness for spidersan-pre.NEW.sh (#1,#3,#4) + spidersan-post.NEW.sh (#2)
set -uo pipefail
HERE="$(cd "$(dirname "$0")/../hooks" && pwd)"
PRE="$HERE/spidersan-pre.sh"
POST="$HERE/spidersan-post.sh"
PASS=0; FAIL=0
ok(){ if echo "$2" | grep -qF "$3"; then echo "  ✅ $1"; PASS=$((PASS+1)); else echo "  ❌ $1"; echo "     got: $2"; FAIL=$((FAIL+1)); fi; }
no(){ if echo "$2" | grep -qF "$3"; then echo "  ❌ $1 (unexpected: $3)"; FAIL=$((FAIL+1)); else echo "  ✅ $1"; PASS=$((PASS+1)); fi; }

# payload builder
pl(){ python3 -c "import json,sys; print(json.dumps({'tool_name':'Bash','tool_input':{'command':sys.argv[1]}}))" "$1"; }

# Stub spidersan CLI, first on PATH for the whole run, so the suite needs no
# install. It keeps the one behaviour the cwd cases depend on: outside
# a repo with a registry it says "not initialized", like the real CLI.
# ponytail: the suite tests the hooks, not the CLI; the CLI has its own tests.
STUBBIN=/tmp/stubbin-sp; rm -rf "$STUBBIN"; mkdir -p "$STUBBIN"
cat > "$STUBBIN/spidersan" <<'STUB'
#!/usr/bin/env bash
[ -f .spidersan/registry.json ] || { echo "❌ Spidersan not initialized. Run: spidersan init" >&2; exit 1; }
[ "$1" = conflicts ] && echo "no conflicts (stub)"
exit 0
STUB
chmod +x "$STUBBIN/spidersan"; export PATH="$STUBBIN:$PATH"; hash -r 2>/dev/null

# spidersan repo with a registry we create, in place of `spidersan init`
T=/tmp/test-hooks-repo; rm -rf "$T"; mkdir -p "$T"; cd "$T"
git init -q; git config user.email t@t.t; git config user.name t; echo a>a.txt; git add .; git commit -qm init
mkdir -p .spidersan; echo '{"version":"1.0","branches":{}}' > .spidersan/registry.json
git add .spidersan; git commit -qm reg >/dev/null 2>&1

echo "═══ #3 force-push-to-trunk guard ═══"
out=$(pl "git push --force-with-lease origin main" | bash "$PRE"); ok "force-with-lease origin main -> warns" "$out" "FORCE-PUSH to a trunk"
out=$(pl "git push --force origin master" | bash "$PRE"); ok "force origin master -> warns" "$out" "FORCE-PUSH to a trunk"
out=$(pl "git push origin +main" | bash "$PRE"); ok "refspec +main -> warns" "$out" "FORCE-PUSH to a trunk"
out=$(pl "git push --force origin myfeature" | bash "$PRE"); no "force to NON-trunk -> no force warn" "$out" "FORCE-PUSH to a trunk"

echo "═══ #4 git push blind-spot reminder ═══"
out=$(pl "git push origin main" | bash "$PRE"); ok "plain push -> blind-spot reminder" "$out" "BLIND to cloud"
no "plain push is NOT flagged as force" "$out" "FORCE-PUSH to a trunk"

echo "═══ #4b inert-CLI guard (fake broken spidersan on PATH) ═══"
# Regression: a pruned node_modules under the npm-linked checkout
# made every check emit a Node stack trace while the push sailed through.
mkdir -p /tmp/fakebin-sp
cat > /tmp/fakebin-sp/spidersan <<'FAKE'
#!/usr/bin/env bash
echo "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander' imported from /x/dist/bin/spidersan.js" >&2
exit 1
FAKE
chmod +x /tmp/fakebin-sp/spidersan
OLD_PATH="$PATH"; export PATH="/tmp/fakebin-sp:$PATH"; hash -r 2>/dev/null
out=$(pl "git push origin main" | bash "$PRE")
ok  "broken CLI -> says the check did not run" "$out" "THIS CHECK DID NOT RUN"
ok  "broken CLI -> names the fix"              "$out" "npm ci"
no  "broken CLI -> no raw stack trace"         "$out" "ERR_MODULE_NOT_FOUND"
export PATH="$OLD_PATH"; hash -r 2>/dev/null
out=$(pl "git push origin main" | bash "$PRE")
no  "healthy CLI -> no false inert warning"    "$out" "THIS CHECK DID NOT RUN"

echo "═══ #1 gh pr merge (fake gh on PATH) ═══"
mkdir -p /tmp/fakebin
printf '#!/usr/bin/env bash\necho "$FAKE_GH_JSON"\n' > /tmp/fakebin/gh; chmod +x /tmp/fakebin/gh
export PATH="/tmp/fakebin:$PATH"
export FAKE_GH_JSON='{"baseRefName":"claude/ecstatic-franklin","mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}'
out=$(pl "gh pr merge 181 --merge" | bash "$PRE"); ok "stacked PR (base!=main) -> STACKED warn" "$out" "STACKED PR"
export FAKE_GH_JSON='{"baseRefName":"main","mergeStateStatus":"UNSTABLE","mergeable":"MERGEABLE"}'
out=$(pl "gh pr merge 178 --merge --delete-branch" | bash "$PRE"); ok "red state (UNSTABLE) -> verify warn" "$out" "mergeStateStatus=UNSTABLE"
export FAKE_GH_JSON='{"baseRefName":"main","mergeStateStatus":"CLEAN","mergeable":"MERGEABLE"}'
out=$(pl "gh pr merge 163 --merge" | bash "$PRE"); ok "clean PR -> looks clean" "$out" "looks clean"
ok "PR number extracted (163)" "$out" "#163"
hash -r 2>/dev/null; export PATH="${PATH#/tmp/fakebin:}"

echo "═══ #2 post-merge trunk-poison auto-heal (BOTH post variants) ═══"
_POST_ORIG="$POST"
for POST in "$HERE/spidersan-post.sh"; do
VARIANT=" [$(basename "$POST")]"
cd "$T"
# poison main with a file, then simulate a merge command
python3 -c "import json;f='.spidersan/registry.json';d=json.load(open(f));d['branches'].setdefault('main',{'name':'main','files':[],'status':'active'});d['branches']['main']['files']=['app/foo.tsx'];json.dump(d,open(f,'w'))"
out=$(pl "gh pr merge 180 --merge" | bash "$POST" 2>&1); ok "poisoned main + merge -> AUTO-HEALED$VARIANT" "$out" "AUTO-HEALED"
# heal above reset main.files to [] -- re-poison before checking the other trigger command
python3 -c "import json;f='.spidersan/registry.json';d=json.load(open(f));d['branches']['main']['files']=['app/foo.tsx'];json.dump(d,open(f,'w'))"
out=$(pl "git merge origin/feat-x" | bash "$POST" 2>&1); ok "git merge also detects poison$VARIANT" "$out" "AUTO-HEALED"
# clean main -> silent
python3 -c "import json;f='.spidersan/registry.json';d=json.load(open(f));d['branches']['main']['files']=[];json.dump(d,open(f,'w'))"
out=$(pl "git merge origin/feat-x" | bash "$POST" 2>&1); no "clean main -> silent$VARIANT" "$out" "AUTO-HEALED"
# non-merge command -> no check
out=$(pl "git status" | bash "$POST" 2>&1); no "non-merge cmd -> no poison output$VARIANT" "$out" "AUTO-HEALED"

# v2.2: the remedy line must match reality. The registry is TRACKED in this fixture,
# so "commit + push" is followable advice. In repos where .spidersan/ is gitignored
# (spidersan-ai's own .gitignore) it is not, and the hook used to say it anyway.
python3 -c "import json;f='.spidersan/registry.json';d=json.load(open(f));d['branches']['main']['files']=['app/foo.tsx'];json.dump(d,open(f,'w'))"
out=$(pl "git merge origin/feat-x" | bash "$POST" 2>&1); ok "tracked registry -> says commit + push$VARIANT" "$out" "Commit + push"
# now make it untracked exactly the way the real repos do, and re-poison
git rm -r --cached .spidersan >/dev/null 2>&1; echo '.spidersan/' >> .gitignore
python3 -c "import json;f='.spidersan/registry.json';d=json.load(open(f));d['branches']['main']['files']=['app/foo.tsx'];json.dump(d,open(f,'w'))"
out=$(pl "git merge origin/feat-x" | bash "$POST" 2>&1); ok "gitignored registry -> still heals$VARIANT" "$out" "AUTO-HEALED"
ok  "gitignored registry -> says local only$VARIANT" "$out" "Local only"
no  "gitignored registry -> does NOT say commit + push$VARIANT" "$out" "Commit + push"
# restore the fixture for anything downstream
git checkout -- .gitignore 2>/dev/null; git add -f .spidersan >/dev/null 2>&1

done
POST="$_POST_ORIG"

echo "═══ v2.1 cwd-hardening: 'cd <repo> && git …' resolves the right repo ═══"
cd /private/tmp 2>/dev/null || cd /tmp   # hook's cwd is NOT the spidersan repo
out=$(pl "cd $T && git push origin main" | bash "$PRE")
no "cd-prefixed push finds the repo (no 'not initialized')" "$out" "not initialized"
ok "cd-prefixed push still emits blind-spot reminder" "$out" "BLIND to cloud"
out=$(pl "cd $T && git merge origin/x" | bash "$PRE")
no "cd-prefixed merge finds the repo (no 'not initialized')" "$out" "not initialized"
cd "$T"

echo "═══ #6 branch-ownership advisory ═══"
# A repo under $HOME so `cd ~/...` is exercised for real, parked on someone
# else's agent-like branch — the abandoned-checkout shape this guard exists for.
TH="$HOME/.spidersan-testrepo"; rm -rf "$TH"; mkdir -p "$TH"
( cd "$TH" && git init -q && git config user.email t@t.t && git config user.name t \
  && echo a > a.txt && git add . && git commit -qm init && git checkout -qb otheragent/topic )
export CLAUDE_CODE_SESSION_ID=hooktest-v24
IDS=$(mktemp -d); echo 'export AGENT=builder-host2' > "$IDS/$CLAUDE_CODE_SESSION_ID.env"
export SPIDERSAN_IDENTITY_FILE="$IDS/{session_id}.env" SPIDERSAN_IDENTITY_KEY=AGENT
unset SPIDERSAN_AGENT

# 1. the miss: an unexpanded tilde emptied repo_root and skipped #5 AND #6
out=$(pl "cd ~/.spidersan-testrepo && git add x && git commit -m y" | bash "$PRE")
ok "tilde cd still reaches the guard" "$out" "not your handle"
ok "  ...and names the offending branch" "$out" "otheragent/topic"
# 2. the false fire: no leading `cd` must not warn about the SESSION's repo
out=$(pl 'SP=/tmp/x; cd "$SP/wt" && git add x && git commit -m y' | bash "$PRE")
no "unresolvable named cd target stays quiet" "$out" "not your handle"
# 3. the name comes from this session's identity file, which wins over SPIDERSAN_AGENT
out=$(pl "cd ~/.spidersan-testrepo && git commit -m y" | SPIDERSAN_AGENT=someone-else bash "$PRE")
ok "warning names the session agent from its identity file" "$out" "('builder-host2')"
# 4. nothing configured: no handle, so no ownership claim at all
out=$(pl "cd ~/.spidersan-testrepo && git commit -m y" | SPIDERSAN_IDENTITY_FILE= bash "$PRE")
no "no identity configured -> no ownership warning" "$out" "not your handle"
out=$(pl "cd ~/.spidersan-testrepo && git commit -m y" | SPIDERSAN_IDENTITY_FILE= SPIDERSAN_AGENT=builder bash "$PRE")
ok "SPIDERSAN_AGENT alone is enough" "$out" "('builder')"
# own branch (and a 2nd instance of it) is not a stray commit
( cd "$TH" && git checkout -q -b builder/topic )
out=$(pl "cd ~/.spidersan-testrepo && git commit -m y" | bash "$PRE")
no "own branch -> no ownership warning" "$out" "not your handle"
( cd "$TH" && git checkout -q -b builder2/topic )
out=$(pl "cd ~/.spidersan-testrepo && git commit -m y" | bash "$PRE")
no "2nd instance (builder2/) -> no warning" "$out" "not your handle"
rm -rf "$TH" "$IDS"
unset CLAUDE_CODE_SESSION_ID SPIDERSAN_IDENTITY_FILE SPIDERSAN_IDENTITY_KEY
cd "$T"

echo "═══ v2.5 #7 dead-branch guard (PR merged/closed, upstream gone) ═══"
# A branch outlives its PR: push accepted, CI green, commits never reach the base.
# #6 cannot catch it — it compares the branch PREFIX to your handle, and on every
# real occurrence the prefix was the author's own. So spider9/ here is deliberately
# "owned": these cases must fire on liveness alone.
D=/tmp/test-hooks-dead; rm -rf "$D"; mkdir -p "$D"; cd "$D"
git init -q; git config user.email t@t.t; git config user.name t
echo a > a.txt; git add .; git commit -qm init
DEF=$(git branch --show-current)
git checkout -q -b spider9/topic

mkdir -p /tmp/fakebin7
printf '#!/usr/bin/env bash\nprintf "%%s" "$FAKE_PR_LINE"\n' > /tmp/fakebin7/gh
chmod +x /tmp/fakebin7/gh
export PATH="/tmp/fakebin7:$PATH"; hash -r 2>/dev/null

export FAKE_PR_LINE="MERGED 280"
out=$(pl "cd $D && git push origin HEAD" | bash "$PRE")
ok "merged PR -> dead-branch warning" "$out" "already has PR #280, state MERGED"
ok "  ...and gives the branch-fresh recovery" "$out" "git checkout -b <handle>/<topic> origin/main"

export FAKE_PR_LINE="CLOSED 42"
out=$(pl "cd $D && git push origin HEAD" | bash "$PRE")
ok "closed PR -> dead-branch warning" "$out" "state CLOSED"

export FAKE_PR_LINE="OPEN 99"
out=$(pl "cd $D && git push origin HEAD" | bash "$PRE")
no "open PR -> silent" "$out" "already has PR"

export FAKE_PR_LINE=""
out=$(pl "cd $D && git push origin HEAD" | bash "$PRE")
no "no PR at all -> silent" "$out" "already has PR"

# Trunk is exempt: pushing to main is a different (and now protection-gated) concern.
( cd "$D" && git checkout -q "$DEF" )
export FAKE_PR_LINE="MERGED 280"
out=$(pl "cd $D && git push origin HEAD" | bash "$PRE")
no "on trunk -> guard skipped" "$out" "already has PR"

# The push path must still emit its original advisory alongside the new warning.
( cd "$D" && git checkout -q spider9/topic )
out=$(pl "cd $D && git push origin HEAD" | bash "$PRE")
ok "  ...#4 blind-spot reminder still emitted" "$out" "registry-only"

hash -r 2>/dev/null; export PATH="${PATH#/tmp/fakebin7:}"; unset FAKE_PR_LINE
rm -rf "$D" /tmp/fakebin7
cd "$T"

echo "═══ dangerous rm: a real deny, judged on rm's own arguments ═══"
# The block must be permissionDecision "deny". `{"continue": false}` let the command run
# and only stopped the agent afterwards (seen live, 0.20.0).
deny(){ [ "$(printf '%s' "$2" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)" = deny ] \
    && { echo "  ✅ $1"; PASS=$((PASS+1)); } || { echo "  ❌ $1 (not denied)"; echo "     got: $2"; FAIL=$((FAIL+1)); }; }
notdeny(){ [ "$(printf '%s' "$2" | jq -r '.hookSpecificOutput.permissionDecision // empty' 2>/dev/null)" != deny ] \
    && ! printf '%s' "$2" | grep -q '"continue": false' \
    && { echo "  ✅ $1"; PASS=$((PASS+1)); } || { echo "  ❌ $1 (blocked)"; echo "     got: $2"; FAIL=$((FAIL+1)); }; }
for c in 'rm -rf /' 'rm -rf ~' 'rm -rf ~/' 'rm -rf $HOME' 'rm -r /tmp/x /' 'cd /tmp && rm -rf ~' 'ls; rm -rf /' 'rm --no-preserve-root -rf /x' \
         'rm -rf "$HOME"' "rm -rf '/'" 'rm -rf "${HOME}/"' 'sudo rm -rf /'; do
    out=$(pl "$c" | bash "$PRE"); deny "denied: $c" "$out"
done
ok "  ...and says why" "$(pl 'rm -rf ~' | bash "$PRE")" "Dangerous rm blocked"
for c in 'cd ~ && rm -rf /tmp/scratch/x' 'rm -rf /tmp/x' 'rm -rf ~/scratch/x' 'cd / && rm -f x' 'rm -rf ./build' 'git rm -r --cached .spidersan' \
         "echo 'rm -rf ~'" 'git commit -m "never rm -rf /"' 'rm -rf "$HOME/scratch"'; do
    out=$(pl "$c" | bash "$PRE"); notdeny "allowed: $c" "$out"
done
ok "  ...an allowed rm still gets the soft warning" "$(pl 'cd ~ && rm -rf /tmp/scratch/x' | bash "$PRE")" "rm detected"

echo "═══ regression: existing behavior intact ═══"
out=$(pl "git merge origin/x" | bash "$PRE"); ok "git merge still runs conflicts advisory" "$out" "Spidersan pre-merge/rebase"

echo ""
echo "═══════════ RESULT: $PASS passed, $FAIL failed ═══════════"
rm -rf "$T" /tmp/fakebin "$STUBBIN"
[ "$FAIL" -eq 0 ]   # the RESULT line alone exited 0 with 11 failures (found by the hooks CI run, 2026-10-25)
