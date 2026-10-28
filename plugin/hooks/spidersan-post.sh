#!/usr/bin/env bash
# === SPIDERSAN_POST_HOOK v=2.1 source=~/.claude/hooks/spidersan-post.sh ===
# PostToolUse(Bash). Keeps registry-sync-on-push; #2 post-merge trunk-poison is
# now AUTO-HEALED (main/master.files reset to [] in the local registry), mirroring
# `spidersan verify-trunk --fix`. Heals local only — agent still commits+pushes.
set -uo pipefail

INPUT=$(cat)
cmd=$(echo "$INPUT" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_input',{}).get('command',''))" 2>/dev/null)

# existing: sync registry to Supabase after a push
if echo "$cmd" | grep -qE '\bgit[[:space:]]+push\b'; then
    spidersan registry-sync --push >/dev/null 2>&1 &
fi

# #2 post-merge: AUTO-HEAL silent registry trunk-poison after a merge.
# A clean auto-merge silently drags a feature branch file-list into the trunk
# entry; main/master must always be files:[]. Reset in place (invariant), report,
# and leave the commit+push to the agent (a hook must never push to main).
if echo "$cmd" | grep -qE '\bgit[[:space:]]+merge\b|\bgh[[:space:]]+pr[[:space:]]+merge\b'; then
    root=$(git rev-parse --show-toplevel 2>/dev/null)
    reg="$root/.spidersan/registry.json"
    if [ -n "$root" ] && [ -f "$reg" ]; then
        # Is the registry actually tracked here? In several repos .spidersan/ is
        # gitignored (spidersan-ai's own .gitignore:32), and telling the agent to
        # "commit + push .spidersan/registry.json" there is advice it cannot follow:
        # git add refuses the path, and the heal is local-only by nature. Reported
        # as a /git-review finding 2026-09-26 — a true sentence pointing at a
        # remedy that does not exist is worse than a generic one, because it is
        # actionable and wrong.
        tracked=0
        git -C "$root" ls-files --error-unmatch ".spidersan/registry.json" >/dev/null 2>&1 && tracked=1
        python3 -c "
import json, sys
reg = sys.argv[1]
try:
    d = json.load(open(reg))
except Exception:
    sys.exit(0)
br = d.get('branches', {})
fixed = [(b, len(br[b]['files']), ', '.join(br[b]['files'][:5]))
         for b in ('main', 'master') if br.get(b, {}).get('files')]
if fixed:
    for b, _, _ in fixed:
        br[b]['files'] = []
    with open(reg, 'w') as fh:
        json.dump(d, fh, indent=2)
        fh.write('\n')
    parts = '; '.join('%s(%d: %s)' % (b, n, p) for b, n, p in fixed)
    tail = ('Commit + push .spidersan/registry.json to clear origin.'
            if len(sys.argv) > 2 and sys.argv[2] == '1'
            else 'Local only — .spidersan/ is gitignored in this repo, so there is nothing to commit; '
                 'the shared copy clears on the next `spidersan registry-sync --push`.')
    msg = '🛡️ Spidersan trunk-poison AUTO-HEALED: %s — reset to files:[] in the local registry. %s' % (parts, tail)
    sys.stderr.write(msg + '\n')
    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': msg}}))
" "$reg" "$tracked" 2>/dev/null
    fi
fi

exit 0
