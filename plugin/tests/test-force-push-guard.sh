#!/usr/bin/env bash
# Self-check for force-push-guard.sh: 2 = blocked (JSON permissionDecision "deny" on stdout), 0 = allowed (silent).
# Every case runs twice: a Claude Code payload, and a Codex one (session_id, cwd, tool_input.workdir).
h=$(cd "$(dirname "$0")/../hooks" && pwd)/force-push-guard.sh
pass=0 fail=0
t() {  # t <expected 2|0> <command>
    for p in '{tool_name:"Bash",tool_input:{command:$c}}' \
             '{session_id:"codex-1",cwd:"/tmp",hook_event_name:"PreToolUse",tool_name:"Bash",tool_input:{command:$c,workdir:"/tmp"}}'; do
        out=$(jq -n --arg c "$2" "$p" | bash "$h" 2>/dev/null); rc=$?
        got=0; [ "$(jq -r '.hookSpecificOutput.permissionDecision // empty' <<<"$out" 2>/dev/null)" = deny ] && got=2
        [ "$rc" = 0 ] && [ "$got" = 2 -o -z "$out" ] || got="exit=$rc out=$out"
        if [ "$got" = "$1" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL (want $1, got $got): $2"; fi
    done
}
t 2 'git push --force'
t 2 'git push -f origin main'
t 2 'git push origin main -f'
t 2 'git push -uf origin x'
t 2 'git push origin +builder3/part-a'
t 2 'git push --mirror backup'
t 2 'git -C ~/code/app push --force origin x'
t 2 'cd ~/code/app && git push -f'
t 2 'git status; git push "--force"'
t 2 'x=$(git push -f)'
t 0 'git push'
t 0 'git push -u origin spidersan2/x'
t 0 'git push --force-with-lease origin x'
t 0 'git push --force-with-lease=x:abc --force-if-includes origin x'
t 0 'git push origin HEAD:builder3/part-a'
t 0 'echo "never git push -f"'
t 0 'git commit -m "fix: push -f is blocked now"'
t 0 'git fetch -f origin'
t 0 'rm -f x && git push'
echo '{}' | bash "$h" && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL: empty payload should allow"; }
echo garbage | bash "$h" 2>/dev/null && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL: garbage should fail open"; }
echo "$pass passed, $fail failed"; [ "$fail" = 0 ]
