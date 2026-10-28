# Sourced by the spidersan hooks: who a Claude Code session is, and how to reach it.
# Nothing is read unless you configure it; with nothing set, the hooks treat
# every session as unknown and stay neutral about ownership.
#
#   SPIDERSAN_IDENTITY_FILE  per-session file, {session_id} is replaced, a leading ~ expands.
#                            e.g. ~/.agent-ids/{session_id}.env holding AGENT=builder-a
#   SPIDERSAN_IDENTITY_KEY   the KEY=value line to read from it (default SPIDERSAN_AGENT)
#   SPIDERSAN_AGENT          this session's handle when there is no file. It is one value
#                            for every session that inherits it, so it never names OTHER sessions.
#   SPIDERSAN_SESSION_HINT   a command to show for reaching another session,
#                            {session_id} is replaced, e.g. "my-sessions watch {session_id}"

# spidersan_session_label <session_id>: that session's handle from the identity file, or nothing.
spidersan_session_label() {
    local sid=$1 f key=${SPIDERSAN_IDENTITY_KEY:-SPIDERSAN_AGENT}
    # The id goes into a path: accept only id characters.
    case $sid in ''|*[!A-Za-z0-9_-]*) return 0 ;; esac
    [ -n "${SPIDERSAN_IDENTITY_FILE:-}" ] || return 0
    f=${SPIDERSAN_IDENTITY_FILE//\{session_id\}/$sid}
    case $f in "~/"*) f="$HOME/${f#\~/}" ;; esac
    [ -f "$f" ] || return 0
    sed -nE "s/^(export[[:space:]]+)?${key}=[\"']?([^\"']*)[\"']?\$/\\2/p" "$f" | head -1
}

# spidersan_my_handle <session_id>: this session's handle (file first, then SPIDERSAN_AGENT).
spidersan_my_handle() {
    local h
    h=$(spidersan_session_label "$1")
    printf '%s' "${h:-${SPIDERSAN_AGENT:-}}"
}

# spidersan_session_hint <session_id>: one indented line telling how to reach it, or nothing.
spidersan_session_hint() {
    [ -n "${SPIDERSAN_SESSION_HINT:-}" ] || return 0
    printf '    %s\n' "${SPIDERSAN_SESSION_HINT//\{session_id\}/$1}"
}
