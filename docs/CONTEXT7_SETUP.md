# Context7 MCP Integration

## Overview

Context7 is an MCP (Model Context Protocol) server by Upstash that provides real-time, version-specific documentation to AI coding assistants like Claude Code, Cursor, and Windsurf. It helps prevent outdated code suggestions by fetching current documentation directly from official sources.

## Installation

Context7 has been installed as a dev dependency:

```bash
npm install --save-dev @upstash/context7-mcp
```

## Configuration

### For Claude Desktop

Add the following to your Claude Desktop MCP configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": [
        "-y",
        "@upstash/context7-mcp"
      ]
    }
  }
}
```

### For Claude Code

If you're using Claude Code via Docker, context7 can be configured in your MCP settings.

### For Cursor / Windsurf

Add to your MCP configuration (typically in `.cursorrules` or IDE settings):

```json
{
  "mcpServers": {
    "context7": {
      "command": "npx",
      "args": ["-y", "@upstash/context7-mcp"]
    }
  }
}
```

## Usage

### Triggering Context7

You can trigger context7 in your prompts by:

1. **Explicit mention**: Add "use context7" to your prompt
2. **Library-specific**: Mention a specific library version (e.g., "using React 18.3.0")
3. **Auto-trigger**: Configure rules in your AI assistant to automatically invoke for certain patterns

### Example Prompts

```
"use context7 to help me implement authentication with Supabase"
```

```
"Show me the latest Next.js 14 app router patterns using context7"
```

```
"I need to add TypeScript types for commander ^12.0.0 - use context7"
```

## Benefits for Spidersan Development

Since Spidersan is a CLI tool for coordinating AI coding agents, context7 provides:

- ✅ **Up-to-date CLI patterns** for tools like Commander.js
- ✅ **Current Git API documentation** for branch operations
- ✅ **Latest TypeScript best practices** for type safety
- ✅ **Accurate Supabase SDK examples** for database operations
- ✅ **Prevention of deprecated patterns** from outdated training data

## Tools Available

Context7 provides two main tools:

1. **`resolve-library-id`**: Identifies libraries and their versions
2. **`get-library-docs`**: Retrieves current documentation

These tools are automatically invoked by your AI assistant when context7 is triggered.

## Troubleshooting

If context7 isn't working:

1. Ensure the MCP server is properly configured in your AI assistant
2. Restart your AI assistant after configuration changes
3. Verify the package is installed: `npm list @upstash/context7-mcp`
4. Check that you're using a compatible AI assistant (Claude, Cursor, Windsurf, etc.)

## Resources

- [Context7 npm package](https://www.npmjs.com/package/@upstash/context7-mcp)
- [Upstash Context7 announcement](https://upstash.com/blog/context7)
- [MCP Protocol documentation](https://modelcontextprotocol.io/)
