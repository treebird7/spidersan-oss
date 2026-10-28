#!/usr/bin/env bash
# === SPIDERSAN_WORKTREE_GUARD v=1.2 (spidersan plugin) ===
# SessionStart. Warns when this worktree already holds UNCOMMITTED work that is
# not this session's: another agent's dirty files, which a branch switch would
# carry or clobber.
#
# Pure git: no registry, no liveness question. Stateless: it re-reads the
# working tree every session, so it cannot raise a permanent alarm. While it
# fires there IS a correct action (commit, stash, or branch off). Silent unless
# it fires. Cross-worktree same-branch collisions are out of scope.
#
# An unknown handle still WARNS (neutrally). At SessionStart a fresh session
# often has no identity yet, and staying silent then would skip exactly the case
# this exists for. Identity is the NOISE SUPPRESSOR, not the trigger: knowing
# the handle keeps us quiet about our own leftovers. $cwd is read whole, since
# paths can hold spaces.
set -uo pipefail

payload=$(cat 2>/dev/null || true)
jget() { printf '%s' "$payload" | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get(sys.argv[1],''))
except Exception: print('')" "$1" 2>/dev/null || true; }
cwd=$(jget cwd); sid=$(jget session_id)
[ -n "$cwd" ] || cwd=$PWD
[ -n "$sid" ] || sid="${CLAUDE_CODE_SESSION_ID:-}"

# --show-toplevel is the WORKTREE root for a linked worktree, which is the key
# that matters: the worktree is where writes land. Same key pre.sh #5 hashes.
root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -n "$root" ] || exit 0

# Tracked modifications only. ponytail: an untracked NEW file is also somebody's
# uncommitted work and this misses it — but untracked is mostly build output and
# scratch, which would fire in every repo. Revisit only if a real collision is
# ever missed this way.
dirty=$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null | head -200)
[ -n "$dirty" ] || exit 0   # clean tree — nothing to attribute, say nothing

branch=$(git -C "$root" branch --show-current 2>/dev/null)
[ -n "$branch" ] || exit 0
prefix="${branch%%/*}"
[ "$prefix" != "$branch" ] || exit 0   # no agent prefix -> no ownership signal

# My handle, same source as spidersan-pre.sh #6 (spidersan-identity.sh).
. "$(dirname "$0")/spidersan-identity.sh"
myhandle=$(spidersan_my_handle "$sid")

if [ -n "$myhandle" ]; then
    mybase="${myhandle%%-*}"
    # Conventional type prefixes are nobody's territory. Unknown prefixes DO
    # warn: pre.sh #6 learned that the hard way (an unfamiliar prefix looked
    # conventional, and the stray commit under it was real).
    case "$prefix" in
        "$myhandle"|"$mybase"|"$mybase"[0-9]*|feat|fix|docs|chore|test|tests|ci|refactor|perf|style|build|release|hotfix|wip|experiment|revert|deps) exit 0 ;;
    esac
    who="prefix '${prefix}/' is not your handle ('${myhandle}')"
    act="Another agent left work here. Do NOT switch branches or commit over it"
else
    # No identity yet (fresh SessionStart). Warn without claiming
    # to know whose work it is — at session open NOTHING in the tree is this
    # session's, so the only honest question is whether it is this agent's.
    who="uncommitted at session open, so none of it is this session's work"
    act="If it is not yours, do NOT switch branches or commit over it"
fi

n=$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')
files=$(printf '%s\n' "$dirty" | head -5 | sed 's/^/    /')
msg="⚠️ Spidersan: this worktree holds ${n} uncommitted file(s) on ${branch} — ${who}.
${files}
${act}: run git status, then stash/commit on their behalf or branch off from here.
Worktree: ${root}"

python3 -c "import json,sys; print(json.dumps({'hookSpecificOutput':{'hookEventName':'SessionStart','additionalContext':sys.argv[1]}}))" "$msg" 2>/dev/null
exit 0
