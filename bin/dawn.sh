#!/usr/bin/env bash
# dawn.sh — Spidersan (ssan) session startup
# Merge/branch manager dawn: git sync + merge queue + vault + colony + inbox
#
# Usage:
#   bin/dawn.sh            # defaults to ssan
#   bin/dawn.sh <agent>    # run as any fleet agent

set -euo pipefail

AGENT_ID="${1:-ssan}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TREEBIRD_INTERNAL="${TREEBIRD_INTERNAL:-/Users/freedbird/Dev/treebird-internal}"
TODAY=$(date +%Y-%m-%d)
COLLAB="$TREEBIRD_INTERNAL/collab/daily/$TODAY-daily.md"
YESTERDAY=$(date -v-1d +%Y-%m-%d 2>/dev/null || date -d yesterday +%Y-%m-%d)
LESSONS="$TREEBIRD_INTERNAL/knowledge/LESSONS_LEARNED_$YESTERDAY.md"

case "$AGENT_ID" in
  bsan)    AGENT_KEY_ID="0f3be59a"; AGENT_CAPS="review,merge,test,audit,context" ;;
  ssan)    AGENT_KEY_ID="8f851dfd"; AGENT_CAPS="review,merge,test,audit,context" ;;
  wsan)    AGENT_KEY_ID="6bd70725"; AGENT_CAPS="review,merge,test,audit,context" ;;
  msan)    AGENT_KEY_ID="d2175d1a"; AGENT_CAPS="review,merge,test,audit,context" ;;
  srlk)    AGENT_KEY_ID="77c71871"; AGENT_CAPS="review,audit,context" ;;
  mycs)    AGENT_KEY_ID="8b99d102"; AGENT_CAPS="review,audit,context" ;;
  tsan)    AGENT_KEY_ID="07683c04"; AGENT_CAPS="review,audit,context" ;;
  yosef)   AGENT_KEY_ID="1ffef837"; AGENT_CAPS="review,test,audit,context" ;;
  mark)    AGENT_KEY_ID="3de8ce22"; AGENT_CAPS="review,merge,test,audit,context" ;;
  arti)    AGENT_KEY_ID="689ca14a"; AGENT_CAPS="review,merge,test,audit,context" ;;
  *)       AGENT_KEY_ID=""; AGENT_CAPS="review,audit,context" ;;
esac

case "$AGENT_ID" in
  mycs) KEY_FILE="$HOME/.envoak/agent-mycsan.key" ;;
  mark) KEY_FILE="$HOME/.envoak/agent-marksan.key" ;;
  *)    KEY_FILE="$HOME/.envoak/agent-${AGENT_ID}.key" ;;
esac

SEP="━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo "🌅 DAWN — $AGENT_ID [Merge/Branch Manager] — $TODAY"
echo "$SEP"

# ── 1. Git sync ───────────────────────────────────────────────────────────────
echo ""
echo "## GIT SYNC"

git_pull() {
  local dir="$1" name="$2"
  local result
  result=$(cd "$dir" && git pull origin main 2>&1)
  if echo "$result" | grep -q "Already up to date"; then
    echo "  $name: up to date"
  else
    echo "  $name: pulled"
    echo "$result" | grep -E "^\s+\w|Updating|Fast-forward|files? changed" | sed 's/^/    /'
  fi
}

git_pull "$REPO_ROOT" "spidersan" &
git_pull "$TREEBIRD_INTERNAL" "treebird-internal" &
wait

# ── 2. Pending tasks ─────────────────────────────────────────────────────────
echo ""
echo "## PENDING TASKS"
PENDING="$REPO_ROOT/.pending_task.md"
if [ -f "$PENDING" ]; then
  awk '/^## P0/,/^## P[12]/' "$PENDING" | head -20
else
  echo "  (no .pending_task.md)"
fi

# ── 3. Active branches + merge queue ─────────────────────────────────────────
echo ""
echo "## BRANCH / MERGE STATUS"
cd "$REPO_ROOT"
echo "  Recent branches:"
git --no-pager branch -a --sort=-committerdate | grep -v "HEAD\|->\\|main" | head -8 | sed 's/^/    /'
echo "  Last 5 merges to main:"
git --no-pager log --oneline --merges main | head -5 | sed 's/^/    /'
cd - >/dev/null

# ── 4. Lessons learned ────────────────────────────────────────────────────────
if [ -f "$LESSONS" ]; then
  echo ""
  echo "## LESSONS LEARNED ($YESTERDAY)"
  head -20 "$LESSONS"
fi

# ── 5. Today's collab ─────────────────────────────────────────────────────────
echo ""
echo "## TODAY'S COLLAB ($TODAY)"
if [ -f "$COLLAB" ]; then
  awk '/^## TLDR/,/^---/' "$COLLAB" | head -15
  echo "  ..."
  grep "^| --" "$COLLAB" | tail -3 | sed 's/^/  /'
else
  echo "  No collab file yet — create: $COLLAB"
fi

# ── 6. Vault status ──────────────────────────────────────────────────────────
echo ""
echo "## VAULT"
if [ -f "$KEY_FILE" ]; then
  KEY_CONTENT=$(cat "$KEY_FILE")
  vault_out=$(TOAK_AGENT_ID="$AGENT_ID" envoak vault inject --key "$KEY_CONTENT" -- envoak vault status 2>&1)
  if echo "$vault_out" | grep -q "Logged in"; then
    echo "$vault_out" | grep -E "Logged in|expires" | sed 's/^/  ✅ /'
  else
    echo "  ❌ Vault not logged in — run: envoak vault login"
  fi
else
  echo "  ⚠️  No agent key at $KEY_FILE"
fi

# ── 7. Colony enlist ─────────────────────────────────────────────────────────
echo ""
echo "## COLONY"
if [ -n "$AGENT_KEY_ID" ]; then
  colony_out=$(envoak colony enlist \
    --label "$AGENT_ID" \
    --key-id "$AGENT_KEY_ID" \
    --capabilities "$AGENT_CAPS" 2>&1) || true

  session_id=$(echo "$colony_out" | grep -i "session" | grep -oE '[0-9a-f-]{8,}' | head -1)
  handoffs=$(echo "$colony_out" | grep -i "handoff" | grep -oE '[0-9]+' | head -1)

  echo "  Session: ${session_id:-?} | Pending handoffs: ${handoffs:-?}"
  [ -n "$handoffs" ] && [ "$handoffs" != "0" ] && echo "  ⚠️  PENDING HANDOFFS — claim before new work"
  echo "$colony_out" | grep -vE "Active|Pending|session|When done|No pending|Enlisted|Label:|Capabilit|Colony|snapshot|^$" | sed 's/^/  /' || true
else
  echo "  ⚠️  No key ID for '$AGENT_ID' — update case block in bin/dawn.sh"
fi

# ── 8. Toak inbox ─────────────────────────────────────────────────────────────
echo ""
echo "## TOAK INBOX"
if [ -f "$KEY_FILE" ]; then
  KEY_CONTENT=$(cat "$KEY_FILE")
  inbox_out=$(TOAK_AGENT_ID="$AGENT_ID" envoak vault inject --key "$KEY_CONTENT" -- toak inbox 2>&1) || true
  echo "$inbox_out" | grep -E "unread|No conversations|inbox" | sed 's/^/  /'
else
  echo "  (skipped — no key file)"
fi

echo ""
echo "$SEP"
echo "✅ Dawn complete — $AGENT_ID ready."
echo ""
echo "   TOAK_AGENT_ID=$AGENT_ID envoak vault inject --key \$(cat $KEY_FILE) -- \\"
echo "     envoak colony signal --status in-progress --task '<task>' --summary '<context>'"
echo ""
