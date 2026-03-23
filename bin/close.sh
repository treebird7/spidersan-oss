#!/usr/bin/env bash
# close.sh — Fleet agent session close ceremony
# Mirrors bin/dawn.sh — run this at the end of every session.
#
# Usage:
#   bin/close.sh [agent-id] "summary of what was done" [OPTIONS]
#
# Options:
#   --p0 "task; task"    P0 items for .pending_task.md
#   --p1 "task; task"    P1 items for .pending_task.md
#   --p2 "task; task"    P2 items for .pending_task.md
#   --context "text"     Key context note for next session
#   --no-git             Skip git commit+push
#   --no-pending         Skip writing .pending_task.md
#
# Examples:
#   bin/close.sh srlk "Signed off SEC-B/C, Android MVP2 audit done"
#   bin/close.sh srlk "Audit complete" \
#     --p1 "SEC-D impl (mycsan); SEC-A impl (bsan)" \
#     --context "srlk key 77c71871 live, SEC-D spec at waltsan/boids/tasks/"

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────────

AGENT_ID="${1:-srlk}"
SUMMARY="${2:-Session closed.}"
shift 2 2>/dev/null || true

P0_TASKS=""
P1_TASKS=""
P2_TASKS=""
CONTEXT_NOTE=""
DO_GIT=true
DO_PENDING=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --p0) P0_TASKS="$2"; shift 2 ;;
    --p1) P1_TASKS="$2"; shift 2 ;;
    --p2) P2_TASKS="$2"; shift 2 ;;
    --context) CONTEXT_NOTE="$2"; shift 2 ;;
    --no-git) DO_GIT=false; shift ;;
    --no-pending) DO_PENDING=false; shift ;;
    *) shift ;;
  esac
done

# ── Bootstrap ─────────────────────────────────────────────────────────────────

TREEBIRD_INTERNAL="${TREEBIRD_INTERNAL:-/Users/freedbird/Dev/treebird-internal}"
TODAY=$(date +%Y-%m-%d)
NOW=$(date +%H:%M)

source "${TREEBIRD_INTERNAL}/bin/agent-registry.sh"

SEP="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "🌇 CLOSE — $AGENT_ID — $TODAY $NOW"
echo "$SEP"

# ── 1. Colony close ──────────────────────────────────────────────────────────
echo ""
echo "## COLONY CLOSE"
colony_out=$(envoak colony close --summary "$SUMMARY" 2>&1) || colony_out="⚠️ colony close failed (session may already be closed)"
echo "  $colony_out" | head -3 | sed 's/^/  /' | sed 's/^    /  /'
echo "  ✓ Signal: idle"

# ── 2. Toak collab sign-off ───────────────────────────────────────────────────
echo ""
echo "## COLLAB SIGN-OFF"
if [ -f "$KEY_FILE" ]; then
  KEY_CONTENT=$(cat "$KEY_FILE")
  collab_msg="$AGENT_ID: **Session close** ($NOW): $SUMMARY"
  collab_out=$(TOAK_AGENT_ID="$AGENT_ID" envoak vault inject --key "$KEY_CONTENT" -- \
    toak collab "$collab_msg" 2>&1) || collab_out="⚠️ collab write failed"
  echo "  $collab_out" | grep -v "Injecting" | head -2 | sed 's/^/  /'
else
  echo "  ⚠️  No key at $KEY_FILE — skipping collab sign-off"
fi

# ── 3. Write .pending_task.md ─────────────────────────────────────────────────
if $DO_PENDING && [ -n "$P0_TASKS$P1_TASKS$P2_TASKS" ]; then
  echo ""
  echo "## PENDING TASK FILE"

  # Determine repo root for pending file (script may be called from any agent repo)
  # Write to AGENT_REPO if set, otherwise treebird-internal
  PENDING_DIR="${AGENT_REPO:-$TREEBIRD_INTERNAL}"
  PENDING_FILE="$PENDING_DIR/.pending_task.md"

  {
    echo "# Pending from $TODAY ($NOW) — ${AGENT_ID} session"
    echo ""
    if [ -n "$P0_TASKS" ]; then
      echo "## P0 — Must Do Next Session"
      IFS=';' read -ra tasks <<< "$P0_TASKS"
      for t in "${tasks[@]}"; do
        t="${t#"${t%%[![:space:]]*}"}"  # ltrim
        [ -n "$t" ] && echo "- [ ] $t"
      done
      echo ""
    fi
    if [ -n "$P1_TASKS" ]; then
      echo "## P1 — This Week"
      IFS=';' read -ra tasks <<< "$P1_TASKS"
      for t in "${tasks[@]}"; do
        t="${t#"${t%%[![:space:]]*}"}"
        [ -n "$t" ] && echo "- [ ] $t"
      done
      echo ""
    fi
    if [ -n "$P2_TASKS" ]; then
      echo "## P2 — Future"
      IFS=';' read -ra tasks <<< "$P2_TASKS"
      for t in "${tasks[@]}"; do
        t="${t#"${t%%[![:space:]]*}"}"
        [ -n "$t" ] && echo "- [ ] $t"
      done
      echo ""
    fi
    if [ -n "$CONTEXT_NOTE" ]; then
      echo "## Key Context"
      echo "$CONTEXT_NOTE"
      echo ""
    fi
  } > "$PENDING_FILE"

  echo "  Wrote: $PENDING_FILE"
  wc -l < "$PENDING_FILE" | xargs -I{} echo "  {} lines"
fi

# ── 4. Git status + commit ────────────────────────────────────────────────────
if $DO_GIT && [ -n "${AGENT_REPO:-}" ] && [ -d "$AGENT_REPO/.git" ]; then
  echo ""
  echo "## GIT ($AGENT_REPO)"
  status_out=$(cd "$AGENT_REPO" && git status --short 2>&1)
  if [ -z "$status_out" ]; then
    echo "  Nothing to commit — clean working tree"
  else
    echo "$status_out" | sed 's/^/  /'
    cd "$AGENT_REPO"
    git add -A
    git commit -m "close $TODAY: $SUMMARY" 2>&1 | grep -E "master|main|\[|nothing" | sed 's/^/  /'
    git push origin main 2>&1 | grep -E "Everything|->|error" | sed 's/^/  /'
  fi
fi

# Also check treebird-internal if it has changes
if $DO_GIT && [ -d "$TREEBIRD_INTERNAL/.git" ]; then
  ti_status=$(cd "$TREEBIRD_INTERNAL" && git status --short 2>&1)
  if [ -n "$ti_status" ]; then
    echo ""
    echo "## GIT (treebird-internal)"
    echo "$ti_status" | sed 's/^/  /'
    echo "  ⚠️  Uncommitted changes — commit manually or re-run with AGENT_REPO set"
  fi
fi

# ── 5. Summary ────────────────────────────────────────────────────────────────
echo ""
echo "$SEP"
echo "✅ Close complete — $AGENT_ID signed off."
echo ""
echo "   Summary: $SUMMARY"
if [ -f "${PENDING_DIR:-$TREEBIRD_INTERNAL}/.pending_task.md" ] && $DO_PENDING; then
  echo "   Pending: ${PENDING_DIR:-$TREEBIRD_INTERNAL}/.pending_task.md"
fi
echo ""
