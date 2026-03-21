#!/bin/bash
# Envoak MCP wrapper — sources shell env to pick up ENVOAK_VAULT_URL etc., then starts MCP server
source ~/.zshrc 2>/dev/null || true

# Set home directory with fallback
HOME_DIR="${HOME:-.}"

exec node "${HOME_DIR}/Dev/envoak/dist/bin/envoak.js" mcp
