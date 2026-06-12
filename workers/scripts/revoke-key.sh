#!/usr/bin/env bash
#
# M2 — key revocation path (#212).
#
# Soft-revoke a spidersan API key: sets `revoked: true` on its KV record so the
# api-proxy rejects it (validateApiKey), while KEEPING the record for audit.
# This is the per-key disable flag the review asked for — no admin endpoint, so
# no new authenticated attack surface.
#
# Usage:
#   ./revoke-key.sh spk_free_<40hex> ["reason"]
#
# Hard removal (no audit trail) is just:
#   npx wrangler kv key delete <key> --namespace-id "$NS" --remote
#
set -euo pipefail

KEY="${1:?usage: revoke-key.sh <spk_...key> [reason]}"
REASON="${2:-manual revocation}"
NS="d05e42b679db41249eb9934a21cc2c78"   # VALID_API_KEYS (matches both wrangler.toml)
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cd "$(dirname "$0")/../keys"

REC="$(npx wrangler kv key get "$KEY" --namespace-id "$NS" --remote 2>/dev/null || true)"
if [ -z "$REC" ]; then
  echo "✗ key not found in KV: $KEY" >&2
  exit 1
fi

UPDATED="$(printf '%s' "$REC" | jq -c \
  --arg t "$NOW" --arg r "$REASON" \
  '. + {revoked: true, revoked_at: $t, revoked_reason: $r}')"

npx wrangler kv key put "$KEY" "$UPDATED" --namespace-id "$NS" --remote >/dev/null
echo "✓ revoked $KEY  (reason: $REASON, at: $NOW)"
echo "  api-proxy will now reject it on next request."
