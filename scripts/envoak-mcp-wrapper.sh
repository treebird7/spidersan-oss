#!/bin/bash
# Envoak MCP wrapper — sources shell env to pick up ENVOAK_VAULT_URL etc., then starts MCP server
source ~/.zshrc 2>/dev/null || true
exec node /Users/freedbird/Dev/envoak/dist/bin/envoak.js mcp
