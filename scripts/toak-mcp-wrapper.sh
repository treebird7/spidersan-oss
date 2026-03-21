#!/bin/bash
# Toak MCP wrapper — injects HUB_URL from config.enc (TOAK_AGENT_ID passed via mcp.json env)
# cd to config dir so envoak can find config.enc
cd "${SPIDERSAN_CONFIG_DIR:-/Users/freedbird/Dev/spidersan-oss}"

# Set up home directory and default paths if not already set
SPIDERSAN_HOME="${SPIDERSAN_HOME:-.}"
HOME_DIR="${HOME:-.}"

# Inject HUB_URL and other secrets from config.enc, then exec toak MCP server
exec node "${HOME_DIR}/Dev/envoak/dist/bin/envoak.js" inject \
  --var HUB_URL TOAK_AGENT_ID \
  -- node "${HOME_DIR}/Dev/toak/dist/bin/toak.js" serve
