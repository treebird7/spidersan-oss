#!/usr/bin/env node

// Generates a VS Code MCP install URI for the local Spidersan MCP server.
// Usage:
//   node scripts/vscode-mcp-install-spidersan.mjs          # prints URI
//   node scripts/vscode-mcp-install-spidersan.mjs --open   # prints + opens URI (macOS)

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'mcp-server', 'dist', 'server.js');

const payload = {
  name: 'spidersan',
  command: 'node',
  args: [serverPath],
  env: {},
};

const uri = `vscode:mcp/install?${encodeURIComponent(JSON.stringify(payload))}`;
console.log(uri);
console.log(`\nTo open in VS Code (macOS):\nopen '${uri.replace(/'/g, "'\\''")}'\n`);

if (process.argv.includes('--open')) {
  if (process.platform === 'darwin') {
    execFileSync('open', [uri], { stdio: 'inherit' });
  } else {
    throw new Error('`--open` is only implemented for macOS. Open the printed URI manually.');
  }
}
