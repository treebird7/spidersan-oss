#!/usr/bin/env node

/**
 * Spidersan MCP Server
 * 
 * Exposes Spidersan branch coordination as MCP tools for Claude Desktop
 * and other MCP-compatible clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as storage from './lib/storage.js';
import { requireProLicense } from './lib/license.js';

// Create the MCP server
const server = new McpServer({
    name: 'spidersan',
    version: '1.0.0',
});

// Tool: list_branches
server.tool(
    'list_branches',
    'List all registered branches in the current project',
    {
        status: z.enum(['all', 'active', 'merged', 'abandoned']).optional()
            .describe('Filter by status (default: active)'),
    },
    async ({ status = 'active' }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ Spidersan not initialized. Run: spidersan init' }],
            };
        }

        const branches = status === 'all'
            ? storage.listBranches()
            : storage.listBranches().filter(b => b.status === status);

        if (branches.length === 0) {
            return {
                content: [{ type: 'text', text: `📋 No ${status} branches registered` }],
            };
        }

        const formatted = branches.map(b => {
            const files = b.files.length > 0 ? b.files.slice(0, 3).join(', ') + (b.files.length > 3 ? '...' : '') : 'none';
            const agent = b.agent ? ` (${b.agent})` : '';
            return `• ${b.name}${agent}: ${b.description || 'No description'}\n  Files: ${files}`;
        }).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Branches (${branches.length} ${status}):\n\n${formatted}`
            }],
        };
    }
);

// Tool: check_conflicts
server.tool(
    'check_conflicts',
    'Check for file conflicts between active branches',
    {},
    async () => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ Spidersan not initialized. Run: spidersan init' }],
            };
        }

        const conflicts = storage.findConflicts();

        if (conflicts.length === 0) {
            return {
                content: [{ type: 'text', text: '✅ No file conflicts detected between active branches' }],
            };
        }

        const formatted = conflicts.map(c =>
            `⚠️ ${c.file}\n   Branches: ${c.branches.join(', ')}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Conflicts detected (${conflicts.length} files):\n\n${formatted}\n\nRecommendation: Coordinate with other agents to avoid merge conflicts.`
            }],
        };
    }
);

// Tool: get_merge_order
server.tool(
    'get_merge_order',
    'Get recommended merge order based on dependencies',
    {},
    async () => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ Spidersan not initialized. Run: spidersan init' }],
            };
        }

        const order = storage.getMergeOrder();

        if (order.length === 0) {
            return {
                content: [{ type: 'text', text: '📋 No active branches to merge' }],
            };
        }

        const formatted = order.map((name, i) => `${i + 1}. ${name}`).join('\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Recommended merge order:\n\n${formatted}\n\nMerge in this order to minimize conflicts.`
            }],
        };
    }
);

// Tool: register_branch
server.tool(
    'register_branch',
    'Register a branch with files you are modifying',
    {
        branch: z.string().describe('Branch name to register'),
        files: z.array(z.string()).describe('List of files being modified'),
        description: z.string().optional().describe('Brief description of the changes'),
        agent: z.string().optional().describe('Your agent identifier'),
        repo: z.string().optional().describe('Repository name (for context)'),
    },
    async ({ branch, files, description, agent, repo }) => {
        // Auto-initialize if needed (global storage doesn't need per-repo init)
        const branchName = branch;

        const existing = storage.getBranch(branchName);
        const branchData = storage.registerBranch({
            name: branchName,
            files: existing ? [...new Set([...existing.files, ...files])] : files,
            status: 'active',
            description: description || existing?.description,
            agent: agent || existing?.agent,
            dependencies: existing?.dependencies,
            repo: repo || existing?.repo,
        });

        const action = existing ? 'Updated' : 'Registered';
        return {
            content: [{
                type: 'text',
                text: `✅ ${action} branch: ${branchData.name}\n   Files: ${branchData.files.join(', ')}\n   Agent: ${branchData.agent || 'not set'}\n   Repo: ${branchData.repo || 'not set'}`
            }],
        };
    }
);

// Tool: mark_merged
server.tool(
    'mark_merged',
    'Mark a branch as merged (removes from active list)',
    {
        branch: z.string().optional().describe('Branch name (default: current branch)'),
    },
    async ({ branch }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ Spidersan not initialized' }],
            };
        }

        let branchName = branch;
        if (!branchName) {
            try {
                branchName = storage.getCurrentBranch();
            } catch {
                return {
                    content: [{ type: 'text', text: '❌ Could not determine current branch' }],
                };
            }
        }

        const success = storage.updateBranchStatus(branchName, 'merged');
        if (!success) {
            return {
                content: [{ type: 'text', text: `❌ Branch not found: ${branchName}` }],
            };
        }

        return {
            content: [{ type: 'text', text: `✅ Marked as merged: ${branchName}` }],
        };
    }
);

// Tool: mark_abandoned
server.tool(
    'mark_abandoned',
    'Mark a branch as abandoned',
    {
        branch: z.string().optional().describe('Branch name (default: current branch)'),
    },
    async ({ branch }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ Spidersan not initialized' }],
            };
        }

        let branchName = branch;
        if (!branchName) {
            try {
                branchName = storage.getCurrentBranch();
            } catch {
                return {
                    content: [{ type: 'text', text: '❌ Could not determine current branch' }],
                };
            }
        }

        const success = storage.updateBranchStatus(branchName, 'abandoned');
        if (!success) {
            return {
                content: [{ type: 'text', text: `❌ Branch not found: ${branchName}` }],
            };
        }

        return {
            content: [{ type: 'text', text: `✅ Marked as abandoned: ${branchName}` }],
        };
    }
);

// Tool: get_branch_info
server.tool(
    'get_branch_info',
    'Get detailed info about a specific branch',
    {
        branch: z.string().optional().describe('Branch name (default: current branch)'),
    },
    async ({ branch }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ Spidersan not initialized' }],
            };
        }

        let branchName = branch;
        if (!branchName) {
            try {
                branchName = storage.getCurrentBranch();
            } catch {
                return {
                    content: [{ type: 'text', text: '❌ Could not determine current branch' }],
                };
            }
        }

        const info = storage.getBranch(branchName);
        if (!info) {
            return {
                content: [{ type: 'text', text: `❌ Branch not registered: ${branchName}\n\nUse register_branch to register it.` }],
            };
        }

        const deps = info.dependencies?.length ? info.dependencies.join(', ') : 'none';
        const text = `🕷️ Branch: ${info.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:       ${info.status}
Agent:        ${info.agent || 'not set'}
Description:  ${info.description || 'none'}
Files:        ${info.files.join(', ') || 'none'}
Dependencies: ${deps}
Registered:   ${new Date(info.registeredAt).toLocaleString()}
Updated:      ${new Date(info.updatedAt).toLocaleString()}`;

        return {
            content: [{ type: 'text', text }],
        };
    }
);

// Start the server
async function main() {
    // Verify Pro license before starting
    requireProLicense();

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Spidersan MCP server running');
}

main().catch(console.error);
