#!/bin/bash
# Toak MCP wrapper — injects HUB_URL from config.enc (TOAK_AGENT_ID passed via mcp.json env)
# cd to Toak dir so envoak can find config.enc
cd "${HOME}/Dev/Toak"

# SECURITY: ENVOAK_KEY must be provided via environment, not hardcoded.
# The previous hardcoded key has been rotated. Set ENVOAK_KEY externally.
if [ -z "$ENVOAK_KEY" ]; then
  echo "ERROR: ENVOAK_KEY environment variable is not set." >&2
  exit 1
fi

# Inject HUB_URL and other secrets from config.enc, then exec toak MCP server
exec node "${HOME}/Dev/Envoak/dist/bin/envoak.js" inject \
  --var HUB_URL TOAK_AGENT_ID \
  -- node "${HOME}/Dev/Toak/dist/bin/toak.js" serve
