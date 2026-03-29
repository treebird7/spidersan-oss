#!/bin/bash
# Toak MCP wrapper — injects HUB_URL from config.enc (TOAK_AGENT_ID passed via mcp.json env)
# cd to Toak dir so envoak can find config.enc
cd "${HOME}/Dev/Toak"

export ENVOAK_KEY="869853411a4b7212ad7cf558c5f1533f1795fd423ca2cdc97e81c2c253bc8689"

# Inject HUB_URL and other secrets from config.enc, then exec toak MCP server
exec node "${HOME}/Dev/Envoak/dist/bin/envoak.js" inject \
  --var HUB_URL TOAK_AGENT_ID \
  -- node "${HOME}/Dev/Toak/dist/bin/toak.js" serve
