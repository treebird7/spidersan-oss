#!/usr/bin/env bash
# PostToolUse(Write|Edit|MultiEdit|NotebookEdit): warn EARLY when the file you just edited is
# also registered on another branch. Advisory-only, fail-open, once per (file, other-branch)
# per checkout — a guard that repeats itself gets ignored.
#
# Install (yourself — the user-level Claude config is config-guarded), AFTER spidersan-autoreg.sh in the same matcher:
#   { "type": "command", "command": "/path/to/spidersan/hooks/claude/spidersan-overlap-warn.sh", "timeout": 8 }
#
# Cross-machine: other machines' branches come from Supabase, so they only show up when this
# session has SPIDERSAN_SUPABASE_URL/KEY (e.g. launched under `envoak vault inject`). Without them
# `conflicts` is fail-open and local-only; the hook then says so once per status per checkout (crossMachine field) (tb-f4bl3).
# ponytail: file-level only (registry + cross-machine when creds are present, same as `conflicts`). No --semantic here:
# that is 1+N gh calls and belongs on the push path. Known gap: autoreg registers async, so the
# very first edit of a brand-new file can miss; the next edit of it catches it.
set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
command -v spidersan >/dev/null 2>&1 || exit 0

file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' 2>/dev/null)
[ -n "$file" ] || exit 0
dir=$(dirname "$file"); [ -d "$dir" ] || exit 0

root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$root/.spidersan" ] || exit 0
branch=$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null) || exit 0
case "$branch" in main|master|"") exit 0 ;; esac    # trunk is never registered with files

# --show-prefix, not string-stripping $root: symlinked paths (macOS /var -> /private/var) differ in spelling
rel="$(git -C "$dir" rev-parse --show-prefix 2>/dev/null)$(basename "$file")"
case "$rel" in .spidersan/*) exit 0 ;; esac

out=$(cd "$root" && spidersan conflicts --json 2>/dev/null) || exit 0
hits=$(printf '%s' "$out" | jq -r --arg f "$rel" \
    '.conflicts[]? | select(.files | index($f)) | "\(.branch)\u001f\(.tier)\u001f\(.sessionId // "")"' 2>/dev/null) || exit 0
# crossMachine (conflicts --json): checked | no-credentials | degraded. Older CLIs omit it => no notice.
cm=$(printf '%s' "$out" | jq -r '.crossMachine // empty' 2>/dev/null)
if [ -z "$hits" ]; then case "$cm" in no-credentials|degraded) ;; *) exit 0 ;; esac; fi

state_dir="${SPIDERSAN_OVERLAP_STATE_DIR:-$HOME/.spidersan/overlap-warned}"
mkdir -p "$state_dir" 2>/dev/null || exit 0
state="$state_dir/$(printf '%s' "$root:$branch" | shasum | cut -c1-12)"
touch "$state" 2>/dev/null || exit 0

msg=""
# \x1f, not tab: read collapses runs of IFS-whitespace, which would shift fields when sessionId is empty
while IFS=$'\x1f' read -r other tier sid; do
    [ -n "$other" ] || continue
    key="$rel	$other"
    grep -qxF -- "$key" "$state" 2>/dev/null && continue    # already told them
    printf '%s\n' "$key" >> "$state"
    who=""
    [ -n "$sid" ] && who=" — session ${sid} (tbe watch ${sid})"
    msg="${msg}⚠️  ${rel} is also registered on '${other}' (TIER ${tier})${who}. Coordinate before going further — check the real overlap: spidersan conflicts --semantic
"
done <<< "$hits"

# Local-only is not "no overlap": say so once per status per checkout, so silence about other machines is explained.
case "$cm" in no-credentials|degraded)
    key="*	cross-machine:$cm"
    if ! grep -qxF -- "$key" "$state" 2>/dev/null; then
        printf '%s\n' "$key" >> "$state"
        msg="${msg}ℹ️  Cross-machine overlap NOT checked here (${cm}) — local branches only. Give the session SPIDERSAN_SUPABASE_URL/KEY (e.g. launch under envoak vault inject) to see other machines.
"
    fi ;;
esac

[ -n "$msg" ] || exit 0
jq -n --arg m "🕷️ Spidersan overlap:
$msg" '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
exit 0
