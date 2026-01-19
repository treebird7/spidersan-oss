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
import { existsSync, realpathSync } from 'fs';
import { resolve, isAbsolute } from 'path';

// Security: Validate directory is safe to watch
function validateWatchDirectory(dir: string | undefined): string {
    const targetDir = dir || process.cwd();
    const absPath = isAbsolute(targetDir) ? targetDir : resolve(process.cwd(), targetDir);

    // Security checks
    if (!existsSync(absPath)) {
        throw new Error(`Directory does not exist: ${absPath}`);
    }

    // Prevent watching sensitive system directories
    const sensitivePatterns = ['/etc', '/var', '/usr', '/bin', '/sbin', '/root', '/home/root'];
    const realPath = realpathSync(absPath);
    for (const pattern of sensitivePatterns) {
        if (realPath.startsWith(pattern)) {
            throw new Error(`Cannot watch system directory: ${pattern}`);
        }
    }

    return realPath;
}

// Create the MCP server
const server = new McpServer({
    name: 'spidersan',
    version: '1.2.3',
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

// Tool: start_watch
server.tool(
    'start_watch',
    'Start watching files and auto-registering changes (daemon mode)',
    {
        agent: z.string().optional().describe('Agent identifier for registrations'),
        dir: z.string().optional().describe('Directory to watch (default: current repo)'),
        hub: z.boolean().optional().describe('Connect to Hub for real-time conflict warnings'),
        quiet: z.boolean().optional().describe('Only show conflicts, not file changes'),
    },
    async ({ agent, dir, hub, quiet }) => {
        // Security: Validate directory before spawning watcher
        let safeDir: string;
        try {
            safeDir = validateWatchDirectory(dir);
        } catch (error: unknown) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ ${(error as Error).message}`
                }],
            };
        }

        // Security: Validate agent ID
        const safeAgent = agent?.replace(/[^a-zA-Z0-9_-]/g, '') || undefined;

        const { spawn } = await import('child_process');
        const args = ['watch'];

        if (safeAgent) args.push('--agent', safeAgent);
        args.push('--dir', safeDir);
        if (hub) args.push('--hub');
        if (quiet) args.push('--quiet');

        // Spawn detached process
        const proc = spawn('spidersan', args, {
            detached: true,
            stdio: 'ignore',
            cwd: safeDir,
        });
        proc.unref();

        return {
            content: [{
                type: 'text',
                text: `🕷️ Watch mode started (PID: ${proc.pid})
Agent: ${safeAgent || 'not set'}
Directory: ${safeDir}
Hub: ${hub ? 'connected' : 'disabled'}
Quiet: ${quiet ? 'yes' : 'no'}

The watcher is running in the background. Use 'stop_watch' to stop it.`
            }],
        };
    }
);

// Tool: stop_watch  
server.tool(
    'stop_watch',
    'Stop the background file watcher',
    {},
    async () => {
        const { execFile } = await import('child_process');

        return new Promise((resolve) => {
            // Security: Use execFile with explicit arguments instead of shell command
            // This prevents command injection and only targets spidersan watch processes
            execFile('pkill', ['-f', 'spidersan watch'], (error) => {
                if (error) {
                    resolve({
                        content: [{
                            type: 'text',
                            text: '⚠️ No watch process found or unable to stop. It may not be running.'
                        }],
                    });
                } else {
                    resolve({
                        content: [{
                            type: 'text',
                            text: '✅ Watch mode stopped.'
                        }],
                    });
                }
            });
        });
    }
);

// Tool: list_tools (for version discovery)
server.tool(
    'list_tools',
    'List all available Spidersan MCP tools with version info',
    {},
    async () => {
        const tools = [
            { name: 'list_branches', desc: 'List registered branches by status', args: 'status?: all|active|merged|abandoned' },
            { name: 'check_conflicts', desc: 'Detect file conflicts between active branches', args: 'none' },
            { name: 'get_merge_order', desc: 'Recommend safe merge sequence', args: 'none' },
            { name: 'register_branch', desc: 'Register branch with files you are modifying', args: 'branch, files[], description?, agent?, repo?' },
            { name: 'mark_merged', desc: 'Mark branch as merged', args: 'branch?' },
            { name: 'mark_abandoned', desc: 'Mark branch as abandoned', args: 'branch?' },
            { name: 'get_branch_info', desc: 'Get detailed info about a branch', args: 'branch?' },
            { name: 'start_watch', desc: 'Start background file watcher daemon', args: 'agent?, dir?, hub?, quiet?' },
            { name: 'stop_watch', desc: 'Stop the background file watcher', args: 'none' },
            { name: 'list_tools', desc: 'This command - list available tools', args: 'none' },
        ];

        const formatted = tools.map(t => `• ${t.name}\n  ${t.desc}\n  Args: ${t.args}`).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Spidersan MCP Server v1.2.3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${formatted}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: ${tools.length} tools available
Pro License: Required for full functionality`
            }],
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
