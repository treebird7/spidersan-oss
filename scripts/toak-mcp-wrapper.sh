#!/bin/bash
# Toak MCP wrapper — resolves identity from Envoak, injects secrets from config.enc
# Used by MCP configs (.mcp.json, .vscode/mcp.json) to start Toak with dynamic identity

# Resolve agent identity from Envoak machine config
export TOAK_AGENT_ID=$(node /Users/freedbird/Dev/envoak/dist/bin/envoak.js machine env 2>/dev/null)

if [ -z "$TOAK_AGENT_ID" ]; then
  echo "WARNING: Could not resolve identity from envoak, falling back to 'cli'" >&2
  export TOAK_AGENT_ID="cli"
fi

# Inject HUB_URL and other secrets from config.enc, then exec toak MCP server
exec node /Users/freedbird/Dev/envoak/dist/bin/envoak.js inject \
  --var HUB_URL \
  -- node /Users/freedbird/Dev/toak/dist/bin/toak.js serve
