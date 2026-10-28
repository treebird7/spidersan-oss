#!/usr/bin/env bash
# Warn when ANOTHER Claude session wrote the same file in this same checkout
# within the last 30 minutes — two agents sharing one worktree, about to clobber
# each other. Replaces the same-branch half of `spidersan watch`: no
# daemon, no registry, no marker written into your files. Claude's session_id
# tells sessions apart, so it works even when both sessions run as the same agent.
#
# Wire it three times (same script):
#   PostToolUse(Write|Edit|MultiEdit|NotebookEdit) — the edited file is the write.
#   PreToolUse(Bash) + PostToolUse(Bash) — snapshots the checkout's changed files
#     (git status + content hash) before and after the command; whatever changed
#     in between is this session's write: `sed -i`, `cat >`, `git checkout/stash/reset`.
#     Only the checkout the session's cwd is in; gitignored files are invisible.
#
# State: <git-dir>/claude-writes, lines "epoch<TAB>session<TAB>label<TAB>path".
# <git-dir> is per worktree, so sibling worktrees never see each other — only
# a shared checkout is the hazard. Warns once per (file, other session) per session.
# Advisory-only, fail-open: any missing tool or odd payload exits 0 silently.
#
# v1.2 (a session wrote 9 files into another's worktree; only 1 warned, and the
# owner's `git commit` swept all 9 into its own commit):
#   (a) PreToolUse(Bash) on `git commit`: DENY when the files it would commit include
#       ones another session wrote in the window and hasn't committed since.
#       Override: put SAME_FILE_OK=1 in the command.
#   (b) PreToolUse(Bash): when the cwd's checkout differs from this session's last
#       one, run spidersan-worktree-guard.sh on it and list other sessions' recent
#       writes there. The guard alone runs only at SessionStart.
#   (c) Any write: warn once per (checkout, other session) when another session
#       wrote ANY file in this checkout in the window, not only the same file.
set -uo pipefail
WINDOW=${SAME_FILE_WARN_WINDOW:-1800}   # seconds

command -v jq >/dev/null 2>&1 || exit 0
payload=$(cat)
IFS=$'\x1f' read -r event tool sid file cwd tuid < <(jq -r '[.hook_event_name // "", .tool_name // "",
    .session_id // "", (.tool_input.file_path // .tool_input.notebook_path // ""), .cwd // "",
    .tool_use_id // ""] | join("\u001f")' <<<"$payload" 2>/dev/null) || exit 0
[ -n "$sid" ] || exit 0

if [ "$tool" = Bash ]; then dir=$cwd; else dir=$(dirname "$file"); fi
COMMIT_RE='(^|[^[:alnum:]_-])git([[:space:]]+-[Cc][[:space:]]+("[^"]*"|'"'"'[^'"'"']*'"'"'|[^[:space:]]+))*[[:space:]]+commit([[:space:]]|$)'
cmd=""
if [ "$tool" = Bash ] && [ "$event" = PreToolUse ]; then
    cmd=$(jq -r '.tool_input.command // ""' <<<"$payload" 2>/dev/null)
    # `cd X && git commit` / `git -C X commit` commit X, not the cwd: judge X's checkout.
    # ponytail: plain cd/-C only; a target set by pushd or a variable is still read as the cwd.
    if grep -Eq "$COMMIT_RE" <<<"$cmd"; then
        target() { case $1 in "~") p=$HOME ;; "~/"*) p="$HOME/${1#\~/}" ;; /*) p=$1 ;; *) p="$dir/$1" ;; esac
                   [ -d "$p" ] && dir=$p; }
        while IFS= read -r t; do [ -n "$t" ] && target "$t"; done < <(perl -e '
            my $c = shift;
            my $arg = q{("[^"]*"|\x27[^\x27]*\x27|[^\s;&|)]+)};
            $c =~ /^(.*?)(?:^|[^\w-])git((?:\s+-[Cc]\s+$arg)*)\s+commit(?:\s|$)/s or exit;
            my ($pre, $opts) = ($1, $2); my $d;
            $d = $1 while $pre =~ /(?:^|[;&|(]|\s)cd\s+$arg/g;
            my @c = $opts =~ /-[Cc]\s+$arg/g;
            for (grep { defined } $d, @c) { s/^["\x27]|["\x27]$//g; print "$_\n" }' "$cmd" 2>/dev/null)
    fi
fi
[ -n "$dir" ] && [ -d "$dir" ] || exit 0
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || exit 0
gitdir=$(git -C "$dir" rev-parse --absolute-git-dir 2>/dev/null) || exit 0
log="$gitdir/claude-writes"; warned="$gitdir/claude-writes.warned"
now=$(date +%s)
HERE=$(cd "$(dirname "$0")" && pwd)

# How to reach the other session: SPIDERSAN_SESSION_HINT if set, else its full id.
. "$HERE/spidersan-identity.sh"
reach_hint() { local h; h=$(spidersan_session_hint "$1"); printf '%s\n' "${h:-    session $1}"; }

# Other sessions with writes in this checkout inside the window:
# "session<TAB>label<TAB>distinct files<TAB>latest epoch".
others() {
    awk -F'\t' -v now="$now" -v w="$WINDOW" -v me="$sid" \
        '$2!=me && now-$1<=w { if (!seen[$2 SUBSEP $4]++) n[$2]++; l[$2]=$3; t[$2]=$1 }
         END { for (s in n) print s "\t" l[s] "\t" n[s] "\t" t[s] }' "$log" 2>/dev/null
}

# "path<TAB>blob-hash" (or "-" if gone) for every changed/untracked file, sorted.
snap() {
    local paths=() hashed=() hashes e p h i=0
    while IFS= read -r -d '' e; do paths+=("${e:3}"); done \
        < <(git -C "$root" status --porcelain -z --no-renames --untracked-files=all 2>/dev/null)
    [ ${#paths[@]} -gt 0 ] || return 0
    hashes=$(cd "$root" && for p in "${paths[@]}"; do [ -f "$p" ] && printf '%s\n' "$p"; done \
        | git hash-object --stdin-paths 2>/dev/null)
    while IFS= read -r h; do hashed+=("$h"); done <<<"$hashes"
    for p in "${paths[@]}"; do
        if [ -f "$root/$p" ]; then printf '%s\t%s\n' "$p" "${hashed[$i]:-?}"; i=$((i + 1))
        else printf '%s\t-\n' "$p"; fi
    done | sort
}

if [ "$tool" = Bash ]; then
    snapfile="$gitdir/claude-snap.${tuid:-$sid}"
    if [ "$event" = PreToolUse ]; then
        # (a) commit guard. Checks before the command runs, so a file another session writes
        # between this check and the command's own `git add` still gets swept (no lock; ceiling).
        if grep -Eq "$COMMIT_RE" <<<"$cmd" \
            && ! grep -q 'SAME_FILE_OK=1' <<<"$cmd"; then
            cand=$(git -C "$root" diff --cached --name-only 2>/dev/null)
            # Staging inside this same command happens after this hook: `add -A|.` counts every
            # changed file, `add -u` / `commit -a` every changed TRACKED file, `git add <paths>` only those paths.
            if grep -Eq 'git[[:space:]]+add[[:space:]]+([^;&|]*[[:space:]])?(-A|--all|\.|:/)([[:space:]]|$)' <<<"$cmd"; then
                cand=$(printf '%s\n%s\n' "$cand" "$(snap | cut -f1)")
            elif grep -Eq 'git[[:space:]]+add[[:space:]]+([^;&|]*[[:space:]])?(-u|--update)([[:space:]]|$)|commit[^;&|]*[[:space:]](-[[:alnum:]]*a[[:alnum:]]*|--all)([[:space:]]|$)' <<<"$cmd"; then
                cand=$(printf '%s\n%s\n' "$cand" "$(git -C "$root" diff --name-only 2>/dev/null)")
            elif grep -Eq 'git[[:space:]]+add[[:space:]]' <<<"$cmd"; then
                named=$(grep -oE 'git[[:space:]]+add[[:space:]]+[^;&|]*' <<<"$cmd" | sed -E 's/^git[[:space:]]+add[[:space:]]+//' \
                    | xargs -n1 printf '%s\n' 2>/dev/null | grep -v "^-" | tr "\n" "\0" \
                    | (cd "$dir" && xargs -0 git ls-files --full-name -m -o --exclude-standard -- 2>/dev/null))
                cand=$(printf '%s\n%s\n' "$cand" "$named")
            fi
            hits=""; sids=""
            while IFS= read -r rel; do
                [ -n "$rel" ] || continue
                w=$(awk -F'\t' -v now="$now" -v w="$WINDOW" -v me="$sid" -v f="$rel" \
                    '$4==f && $2!=me && now-$1<=w { t=$1; l=$3; s=$2 } END { if (t) print t "\t" l "\t" s }' "$log" 2>/dev/null)
                [ -n "$w" ] || continue
                # Their write is already in a commit: what is staged now is not theirs.
                c=$(git -C "$root" log -1 --format=%ct -- "$rel" 2>/dev/null)
                [ "${w%%$'\t'*}" -le "${c:-0}" ] && continue
                IFS=$'\t' read -r _ who other <<<"$w"
                hits="${hits}    $rel — $who (session ${other:0:8})
"
                case " $sids " in *" $other "*) ;; *) sids="$sids $other" ;; esac
            done < <(printf '%s\n' "$cand" | sort -u)
            if [ -n "$hits" ]; then
                jq -n --arg r "🕷️ Commit blocked: it would include files another session wrote in this checkout in the last $((WINDOW / 60)) min and has not committed:
${hits}They are probably not yours. Unstage them (git restore --staged <file>) and commit only your own files. If they really belong in this commit, rerun with SAME_FILE_OK=1 in the command.
To check with the session that wrote them:
$(for o in $sids; do reach_hint "$o"; done)" \
                    '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
                exit 0
            fi
        fi
        { echo "$now"; snap; } > "$snapfile"
        # (b) the cwd moved into another checkout mid-session
        state="$HOME/.claude/state/same-file-warn"; mkdir -p "$state" 2>/dev/null
        prev=$(cat "$state/$sid.root" 2>/dev/null)
        [ "$prev" = "$root" ] && exit 0
        printf '%s\n' "$root" > "$state/$sid.root" 2>/dev/null
        # first Bash call: SessionStart's guard already checked this checkout. Once per
        # session, drop .root files of sessions idle 30+ days (one is written per session).
        [ -n "$prev" ] || { find "$state" -name '*.root' -mtime +30 -delete 2>/dev/null; exit 0; }
        ctx=$(jq -n --arg c "$cwd" --arg s "$sid" '{cwd:$c,session_id:$s}' \
            | bash "$HERE/spidersan-worktree-guard.sh" 2>/dev/null | jq -r '.hookSpecificOutput.additionalContext // empty' 2>/dev/null)
        o=$(others | while IFS=$'\t' read -r other who n t; do
            echo "    $who (session ${other:0:8}): $n file(s), latest $(( (now - t) / 60 )) min ago"; done)
        [ -n "$o" ] && ctx="${ctx:+$ctx
}🕷️ You just moved into $root, where other sessions wrote recently:
$o
This may be another session's worktree. Make your own (git worktree add ../<repo>-<topic>) and check the exit status before you cd anywhere."
        [ -n "$ctx" ] || exit 0
        jq -n --arg m "$ctx" '{hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:$m}}'
        exit 0
    fi
    [ -f "$snapfile" ] || exit 0
    started=$(head -n 1 "$snapfile")
    after=$(snap)
    # Paths whose line differs between the two snapshots changed during the command.
    changed=$( { tail -n +2 "$snapfile"; printf '%s\n' "$after"; } | sed '/^$/d' | sort | uniq -u | cut -f1 | sort -u)
    rm -f "$snapfile"
    [ -n "$changed" ] || exit 0
else
    # --show-prefix, not string-stripping: symlinked paths (macOS /var -> /private/var) differ in spelling
    changed="$(git -C "$dir" rev-parse --show-prefix 2>/dev/null)$(basename "$file")"
    started=$now
fi

# Who am I, for the other session's warning (spidersan-identity.sh).
label=$(spidersan_my_handle "$sid")
label=${label:-unknown agent}

msg=""
while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    # Latest write of this file by each other session inside the window.
    hits=$(awk -F'\t' -v now="$now" -v w="$WINDOW" -v me="$sid" -v f="$rel" \
        '$4==f && $2!=me && now-$1<=w { t[$2]=$1; l[$2]=$3 } END { for (s in t) print t[s] "\t" s "\t" l[s] }' \
        "$log" 2>/dev/null)
    mine=1
    while IFS=$'\t' read -r t other who; do
        [ -n "$other" ] || continue
        # Another session wrote it while our command ran: that change is theirs, not ours.
        [ "$t" -ge "$started" ] && [ "$tool" = Bash ] && mine=0
        key="$sid	$other	$rel"
        grep -qxF -- "$key" "$warned" 2>/dev/null && continue
        printf '%s\n' "$key" >> "$warned"
        msg="${msg}⚠️  $rel was also written $(( (now - t) / 60 )) min ago by $who (session ${other:0:8}) in this same checkout.
"
    done <<<"$hits"
    [ "$mine" = 1 ] && printf '%s\t%s\t%s\t%s\n' "$now" "$sid" "$label" "$rel" >> "$log"
done <<<"$changed"

# (c) any other session's writes in this checkout, once per (checkout, other session)
while IFS=$'\t' read -r other who n t; do
    [ -n "$other" ] || continue
    key="$sid	$other	*"
    grep -qxF -- "$key" "$warned" 2>/dev/null && continue
    printf '%s\n' "$key" >> "$warned"
    msg="${msg}⚠️  $who (session ${other:0:8}) wrote $n file(s) in this checkout, latest $(( (now - t) / 60 )) min ago. You may be in another session's worktree. Check with it:
$(reach_hint "$other")
"
done < <(others)

# ponytail: crude size cap; old lines are outside the window anyway
[ -f "$log" ] && [ "$(wc -l < "$log")" -gt 2000 ] && { tail -n 500 "$log" > "$log.tmp" && mv "$log.tmp" "$log"; }

[ -n "$msg" ] || exit 0
jq -n --arg m "🕷️ Shared checkout:
${msg}Re-read the file before editing further, and coordinate — or move to your own worktree (git worktree add ../<repo>-<topic>)." \
    '{hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:$m}}'
