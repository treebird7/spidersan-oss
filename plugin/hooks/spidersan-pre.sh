#!/usr/bin/env bash
# === SPIDERSAN_PRE_HOOK v=2.7 (spidersan plugin) ===
# PreToolUse(Bash). Advisory-only (never blocks) except the dangerous-rm hard
# block. Checks: force-push-to-trunk (#3), gh-pr-merge stacked/red state (#1), a
# blind-spot reminder on git push (#4), a concurrent-checkout busy guard on
# git add|commit (#5), a branch-ownership advisory (#6), and a dead-branch guard
# on git push (#7: the branch's PR already merged or closed, or its upstream is gone).
# A `cd <repo> && git …` command is judged against <repo>, not the hook's cwd.
# Agent identity comes from spidersan-identity.sh; unset, #6 stays silent.
set -uo pipefail

INPUT=$(cat)
# One python3 for both fields: the session id on line 1, the command (any lines) after it.
fields=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('session_id','')); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)
sid=${fields%%$'\n'*}
cmd=${fields#*$'\n'}; [ "$cmd" != "$fields" ] || cmd=""
sid="${sid:-${CLAUDE_CODE_SESSION_ID:-}}"
. "$(dirname "$0")/spidersan-identity.sh"

# First line only — prevents heredoc false positives
cmd_first=$(echo "$cmd" | head -1 | sed 's/<<.*//')

# Strip quoted strings before rm checks — prevents echo 'rm ~/' false-blocking
cmd_unquoted=$(echo "$cmd_first" | python3 -c "
import re, sys
s = sys.stdin.read()
s = re.sub(r'\"[^\"]*\"', '', s)
s = re.sub(r\"'[^']*'\", '', s)
print(s)
" 2>/dev/null)

# rm: DENY when an rm command's own arguments name the root or home dir (or pass
# --no-preserve-root). Judged per command segment (split on && || ; |), so a `cd ~`
# elsewhere in the line no longer counts, and `git rm` is not rm.
# The answer is permissionDecision "deny": `{"continue": false}` let the command run
# and only stopped the agent afterwards.
# Parsed with shlex from the UNstripped line, so a quoted target ("\$HOME", '/') counts,
# while `echo 'rm ~'` is an echo segment and never an rm.
rm_danger=$(printf '%s' "$cmd_first" | python3 -c "
import re, shlex, sys
for seg in re.split(r'&&|\|\||;|\|', sys.stdin.read()):
    try:
        w = shlex.split(seg)
    except ValueError:
        w = seg.split()
    while w and (re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', w[0]) or w[0] in ('sudo', 'command', 'env', 'nohup')):
        w = w[1:]
    if not w or w[0].rsplit('/', 1)[-1] != 'rm':
        continue
    for a in w[1:]:
        if a == '--no-preserve-root' or a.rstrip('/') in ('', '~', '\$HOME', '\${HOME}'):
            print('y'); sys.exit()
" 2>/dev/null)
if [ "$rm_danger" = y ]; then
    python3 -c "import json; print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'permissionDecision': 'deny', 'permissionDecisionReason': '🛑 Dangerous rm blocked: targets home dir or root. Verify before proceeding.'}}))"
    exit 0
fi

# rm: soft warn any other rm (allows through)
if echo "$cmd_unquoted" | grep -qE '\brm\b'; then
    python3 -c "import json; print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'additionalContext': '⚠️  rm detected — double-check paths are correct before proceeding.'}}))"
    exit 0
fi

# Resolve the repo the git command targets, so the conflicts advisory runs in the
# right place even when invoked as `cd <repo> && git …` (PreToolUse fires BEFORE the cd).
# Honor a leading `cd <path>`; otherwise fall back to the hook's own cwd.
# NB: no pattern backreferences — BSD/macOS sed -E doesn't support them.
cd_target=$(echo "$cmd_first" | sed -nE 's/^[[:space:]]*cd[[:space:]]+([^[:space:]&;|]+).*/\1/p')
# sed captures the path LITERALLY: a leading ~ must be expanded here or git
# fails on it, repo_root goes empty and #5 and #6 are silently skipped.
cd_target="${cd_target#\"}"; cd_target="${cd_target%\"}"      # strip quotes: cd "$X/y"
cd_target="${cd_target/#\~/$HOME}"                            # expand a leading ~
# Empty cd_target -> '.' (the hook's cwd). A NAMED but unresolvable target
# leaves repo_root empty and the guards quiet, which is deliberate: warning
# about the session's repo while the command commits somewhere ELSE is worse
# than silence — that false fire is what taught me to ignore this guard.
repo_root=$(git -C "${cd_target:-.}" rev-parse --show-toplevel 2>/dev/null)

# #5 concurrent-checkout busy guard (git add|commit) — advisory, stateless.
# A second agent committing on the SAME local checkout can land its commit on
# your branch + sweep your staged files.
# A PreToolUse hook is too short-lived to HOLD a lock across the commit, but a
# PID-stamped busy file + liveness check catches a live contender. Staleness =
# kill -0 (process death releases it instantly), not a TTL.
if [ -n "$repo_root" ] && echo "$cmd_first" | grep -qE '\bgit[[:space:]]+(add|commit)\b'; then
    lock_dir="$HOME/.spidersan/locks"; mkdir -p "$lock_dir" 2>/dev/null
    h=$(echo "$repo_root" | shasum 2>/dev/null | cut -c1-12)
    L="$lock_dir/$h.busy"
    myhandle=$(spidersan_my_handle "$sid")
    agent="${myhandle:-unknown}"
    warn=""
    if [ -f "$L" ]; then
        read -r opid oepoch oagent _ < "$L" 2>/dev/null || true
        now=$(date +%s)
        if [ -n "${opid:-}" ] && [ "$opid" != "$$" ] && kill -0 "$opid" 2>/dev/null \
           && [ $((now - ${oepoch:-0})) -lt 10 ]; then
            warn="⚠️ ${oagent:-another agent} (pid $opid) is mid-commit on this checkout (<10s ago) — pause before git add/commit or your staged files may land on their branch."
        fi
    fi
    printf '%s %s %s\n' "$$" "$(date +%s)" "$agent" > "$L" 2>/dev/null || true

    # #6 abandoned-checkout / branch-ownership advisory: a previous session left
    # this checkout on ITS branch. Silent when the handle is unknown (human shell).
    # A handle may carry a suffix (builder-host2) while branches use the base,
    # with a digit for a second instance (builder/, builder2/). Compare on the base.
    mybase="${myhandle%%-*}"
    branch=$(git -C "$repo_root" branch --show-current 2>/dev/null)
    own_warn=""
    if [ -n "$myhandle" ] && [ -n "$branch" ] && [ "$branch" != "main" ] && [ "$branch" != "master" ] \
       && [ "${branch%%/*}" != "$branch" ]; then
        prefix="${branch%%/*}"
        # Conventional type prefixes are nobody's territory — only warn on
        # agent-like prefixes that aren't mine. Heuristic, not a roster lookup:
        # unknown prefixes warn (a stray commit under an unfamiliar prefix was real).
        case "$prefix" in
            "$myhandle"|"$mybase"|"$mybase"[0-9]*|feat|fix|docs|chore|test|tests|ci|refactor|perf|style|build|release|hotfix|wip|experiment|revert|deps) ;;
            *) own_warn="⚠️ You are about to commit on ${branch} — prefix '${prefix}/' is not your handle ('${myhandle}'). A previous session may have left this checkout on ITS branch. Check: git branch --show-current; switch or branch off before committing." ;;
        esac
    fi

    if [ -n "$warn" ] && [ -n "$own_warn" ]; then
        msg="$warn
$own_warn"
    elif [ -n "$own_warn" ]; then
        msg="$own_warn"
    else
        msg="${warn:-🕷️ Spidersan: no other agent mid-commit on this checkout.}"
    fi
    python3 -c "import json,sys; print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','additionalContext':sys.argv[1]}}))" "$msg" 2>/dev/null
    exit 0
fi

# #3 force-push to a trunk branch — advisory soft-confirm (MUST precede generic push case)
if echo "$cmd_first" | grep -qE '\bgit[[:space:]]+push\b' && \
   echo "$cmd_first" | grep -qE '(--force([[:space:]]|$)|--force-with-lease|[[:space:]]-f([[:space:]]|$)|[[:space:]]\+(main|master)\b)' && \
   echo "$cmd_first" | grep -qE '\b(main|master)\b'; then
    python3 -c "import json; print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'additionalContext': '🛡️ FORCE-PUSH to a trunk branch (main/master). This can REWRITE shared history (cf. the main-rewrite incident, restored via lease-push). Confirm intent; prefer --force-with-lease; never on a branch others are working.'}}))"
    exit 0
fi

# sp_conflicts <tier> — run the CLI, or say plainly that it could not run.
#
# A missing CLI, or one whose node_modules were pruned (a common state for an
# npm-linked checkout), turns every check below into a Node stack trace. The
# push still succeeds, so the operator learns to scroll past it, and a guard
# nobody reads is a guard that is not running.
#
# Discriminate on the crash signature, NOT on exit status: `conflicts
# --strict` exits non-zero precisely when it finds real conflicts, so keying
# off $? would swallow the finding this hook exists to surface.
sp_conflicts() {
    _out=$( [ -n "$repo_root" ] && cd "$repo_root"; spidersan conflicts --tier "$1" --strict 2>&1 )
    case "$_out" in
        *ERR_MODULE_NOT_FOUND*|*"Cannot find module"*|*"node:internal/"*|*"command not found"*)
            printf '%s' "⛔ THIS CHECK DID NOT RUN — the spidersan CLI cannot start (missing, or its dependencies are).
    Fix:  npm i -g spidersan   (for a linked checkout: npm ci in that checkout)
    Until then this operation has NO conflict check." ;;
        *) printf '%s' "$_out" ;;
    esac
}

# #4 git push — registry conflicts advisory + cloud-PR blind-spot reminder
if echo "$cmd_first" | grep -qE '\bgit[[:space:]]+push\b'; then
    # #7 dead-branch guard — see the v2.5 note in the header. Advisory, never blocks:
    # re-opening a closed PR is a real if rare intent, and this file blocks nothing
    # but dangerous rm.
    DEAD_WARN=""
    if [ -n "$repo_root" ]; then
        br=$(git -C "$repo_root" branch --show-current 2>/dev/null)
        if [ -n "$br" ] && [ "$br" != "main" ] && [ "$br" != "master" ]; then
            # Remote ref deleted underneath us — common after `--delete-branch`.
            if git -C "$repo_root" status -sb 2>/dev/null | head -1 | grep -q '\[gone\]'; then
                DEAD_WARN="⚠️ Upstream for '${br}' is GONE — the remote branch was deleted. This push recreates a dead ref that no PR is watching."
            fi
            pr_line=$( cd "$repo_root" 2>/dev/null && gh pr list --head "$br" --state all \
                         --json number,state --jq '.[0] | "\(.state) \(.number)"' 2>/dev/null || true )
            case "$pr_line" in
                MERGED\ *|CLOSED\ *)
                    st="${pr_line%% *}"; num="${pr_line##* }"
                    DEAD_WARN="${DEAD_WARN:+$DEAD_WARN
}❌ Branch '${br}' already has PR #${num}, state ${st}. Git will ACCEPT this push and CI will go GREEN on the branch — and the commits will NOT land on the base. Branch fresh instead:
    git fetch origin && git checkout -b <handle>/<topic> origin/main && git cherry-pick <sha>"
                    ;;
            esac
        fi
    fi
    export DEAD_WARN

    result=$(sp_conflicts 2)
    echo "$result" | python3 -c "
import json, sys, os
result = sys.stdin.read().strip()
msg = '🕷️ Spidersan pre-push:\n' + result if result else '🕷️ Spidersan: no local conflicts'
dead = os.environ.get('DEAD_WARN', '').strip()
if dead:
    msg = dead + '\n' + msg
msg += '\n⚠️ Local check is registry-only — BLIND to cloud claude/* PRs + CI. For the real merge picture: gh pr list --json files,mergeable,baseRefName  (or npx spidersan github-sync).'
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'additionalContext': msg}}))
" 2>/dev/null
    exit 0
fi

# git merge/rebase — advisory only, never block
if echo "$cmd_first" | grep -qE '\bgit[[:space:]]+(merge|rebase)\b'; then
    result=$(sp_conflicts 3)
    echo "$result" | python3 -c "
import json, sys
result = sys.stdin.read().strip()
msg = '🕷️ Spidersan pre-merge/rebase:\n' + result if result else '🕷️ Spidersan: no conflicts detected'
msg += '\n⚠️ Registry overlap only — this is NOT a merge simulation and is BLIND to add/add and content conflicts against the base. Before you actually merge: spidersan conflicts --real --base origin/<trunk>'
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'additionalContext': msg}}))
" 2>/dev/null
    exit 0
fi

# #1 gh pr merge — advisory: catch stacked PR (base != trunk) and not-clean state
if echo "$cmd_first" | grep -qE '\bgh[[:space:]]+pr[[:space:]]+merge\b'; then
    prnum=$(echo "$cmd_first" | grep -oE '[0-9]+' | head -1)
    if [ -n "$prnum" ]; then
        gh pr view "$prnum" --json baseRefName,mergeStateStatus,mergeable 2>/dev/null | python3 -c "
import json, sys
pr = sys.argv[1] if len(sys.argv) > 1 else '?'
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
base = d.get('baseRefName', ''); state = d.get('mergeStateStatus', '')
w = []
if base and base not in ('main', 'master'):
    w.append('STACKED PR: base=%s (not trunk) — merging lands on %s, NOT main.' % (base, base))
if state in ('UNSTABLE', 'DIRTY', 'BEHIND', 'BLOCKED'):
    w.append('mergeStateStatus=%s — red/behind/conflicts; verify before merging.' % state)
if w:
    msg = '🕷️ Spidersan pre-merge #%s:\n' % pr + '\n'.join('⚠️ ' + x for x in w)
else:
    msg = '🕷️ Spidersan: PR #%s base=%s state=%s — looks clean.' % (pr, base, state)
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PreToolUse', 'additionalContext': msg}}))
" "$prnum"
    fi
    exit 0
fi

exit 0
