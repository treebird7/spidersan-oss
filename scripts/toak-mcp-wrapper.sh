#!/bin/bash
# Toak MCP wrapper — injects secrets from config.enc, then starts Toak MCP server
# Agent identity is resolved by Toak from ~/.toak/config.json (do not override TOAK_AGENT_ID here)

# Inject HUB_URL and other secrets from config.enc, then exec toak MCP server
exec node /Users/freedbird/Dev/envoak/dist/bin/envoak.js inject \
  --var HUB_URL TOAK_AGENT_ID \
  -- node /Users/freedbird/Dev/toak/dist/bin/toak.js serve
