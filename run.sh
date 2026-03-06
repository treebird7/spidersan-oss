#!/usr/bin/env bash
# Spidersan — vault-injected runner
# Secrets injected via envoak vault inject + agent key.
# Non-secret config (SPIDERSAN_AGENT, HUB_URL, etc.) stays in .env
set -euo pipefail

KEY_FILE="${ENVOAK_AGENT_KEY_FILE:-$HOME/.envoak/spidersan.key}"

if [ ! -f "$KEY_FILE" ]; then
    echo "❌ Missing agent key: $KEY_FILE"
    echo "Create one: envoak vault keys create-with-grants --label spidersan --ttl-days 365 --grants supabase/KEY supabase/KEY_PROD supabase/URL supabase/URL_PROD spidersan/COLONY_SUPABASE_URL spidersan/COLONY_SUPABASE_KEY"
    exit 1
fi

cd "$(dirname "$0")"
envoak vault inject --key "$(cat "$KEY_FILE")" -- node dist/bin/spidersan.js "$@"
