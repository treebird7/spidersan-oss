#!/bin/bash
# Toak MCP wrapper — injects HUB_URL from config.enc (TOAK_AGENT_ID passed via mcp.json env)
# cd to config dir so envoak can find config.enc
cd "${SPIDERSAN_CONFIG_DIR:-/Users/freedbird/Dev/spidersan-oss}"

# Inject HUB_URL from config.enc, then exec toak MCP server
exec node /Users/freedbird/Dev/envoak/dist/bin/envoak.js inject \
  --var HUB_URL \
  -- node /Users/freedbird/Dev/toak/dist/bin/toak.js serve
