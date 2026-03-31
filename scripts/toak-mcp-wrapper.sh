#!/bin/bash
# Toak MCP wrapper — injects HUB_URL from config.enc (TOAK_AGENT_ID passed via mcp.json env)
# cd to Toak dir so envoak can find config.enc
cd "${HOME}/Dev/Toak"

export ENVOAK_KEY="d7edd0aa19a983c449135310822a33cb4971f8b41122bd2d37785940304a0789"

# Inject HUB_URL and other secrets from config.enc, then exec toak MCP server
exec node "${HOME}/Dev/Envoak/dist/bin/envoak.js" inject \
  --var HUB_URL TOAK_AGENT_ID \
  -- node "${HOME}/Dev/Toak/dist/bin/toak.js" serve
