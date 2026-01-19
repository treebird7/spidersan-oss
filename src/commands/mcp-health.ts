import { Command } from 'commander';
import { execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';
const MCP_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_config.json');

interface McpServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
}

interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
}

/**
 * Read MCP config from Antigravity config file
 */
function readMcpConfig(): McpConfig | null {
    try {
        if (!fs.existsSync(MCP_CONFIG_PATH)) {
            console.log(`⚠️ MCP config not found: ${MCP_CONFIG_PATH}`);
            return null;
        }
        const content = fs.readFileSync(MCP_CONFIG_PATH, 'utf-8');
        return JSON.parse(content) as McpConfig;
    } catch (err) {
        console.log(`⚠️ Failed to read MCP config: ${err}`);
        return null;
    }
}

/**
 * Start an MCP server from config
 */
function startMcpServer(name: string, config: McpServerConfig): boolean {
    try {
        const env = { ...process.env, ...config.env };
        const child = spawn(config.command, config.args, {
            detached: true,
            stdio: 'ignore',
            env
        });
        child.unref();
        console.log(`🚀 Started ${name} (PID: ${child.pid})`);
        return true;
    } catch (err) {
        console.log(`❌ Failed to start ${name}: ${err}`);
        return false;
    }
}

// Known MCP servers in the Treebird ecosystem
const KNOWN_MCP_SERVERS = [
    { name: 'watsan-mcp', pattern: 'watsan.*mcp', required: true },
    { name: 'myceliumail-mcp', pattern: 'myceliumail.*mcp', required: true },
    { name: 'spidersan-mcp', pattern: 'spidersan.*mcp', required: false },
    { name: 'supabase-mcp', pattern: 'supabase.*mcp', required: false },
    { name: 'perplexity-mcp', pattern: 'perplexity', required: false },
];

interface ProcessInfo {
    pid: number;
    command: string;
    uptime: string;
}

function findMcpProcesses(): Map<string, ProcessInfo[]> {
    const results = new Map<string, ProcessInfo[]>();

    try {
        // Get all MCP-related processes
        const output = execSync('ps aux | grep -E "mcp|MCP" | grep -v grep', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();

        if (!output) return results;

        const lines = output.split('\n');

        for (const line of lines) {
            const parts = line.split(/\s+/);
            if (parts.length < 11) continue;

            const pid = parseInt(parts[1], 10);
            const startTime = parts[8]; // TIME column
            const command = parts.slice(10).join(' ');

            // Match against known servers
            for (const server of KNOWN_MCP_SERVERS) {
                const regex = new RegExp(server.pattern, 'i');
                if (regex.test(command)) {
                    if (!results.has(server.name)) {
                        results.set(server.name, []);
                    }
                    results.get(server.name)!.push({
                        pid,
                        command: command.substring(0, 60) + (command.length > 60 ? '...' : ''),
                        uptime: startTime
                    });
                }
            }

            // Check for unknown MCP servers
            if (!Array.from(results.values()).some(procs => procs.some(p => p.pid === pid))) {
                if (/mcp|MCP/.test(command)) {
                    const unknownKey = 'unknown-mcp';
                    if (!results.has(unknownKey)) {
                        results.set(unknownKey, []);
                    }
                    results.get(unknownKey)!.push({
                        pid,
                        command: command.substring(0, 60) + (command.length > 60 ? '...' : ''),
                        uptime: startTime
                    });
                }
            }
        }
    } catch (err) {
        // No processes found - that's okay
    }

    return results;
}

function getProcessUptime(pid: number): string {
    try {
        const output = execSync(`ps -p ${pid} -o etime=`, { encoding: 'utf-8' }).trim();
        return output || 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * Post MCP health summary to Hub chat
 */
async function postToHubChat(healthReport: Record<string, { status: string; pids: number[]; zombieCount: number }>, hasIssues: boolean): Promise<void> {
    const running = Object.entries(healthReport).filter(([_, v]) => v.status === 'running').length;
    const stopped = Object.entries(healthReport).filter(([_, v]) => v.status === 'stopped').length;
    const zombies = Object.entries(healthReport).filter(([_, v]) => v.status === 'zombie').length;

    const statusIcon = hasIssues ? '⚠️' : '✅';
    const statusText = hasIssues ? 'Issues detected' : 'All healthy';

    const serverLines = Object.entries(healthReport)
        .map(([name, info]) => {
            const icon = info.status === 'running' ? '✅' : info.status === 'zombie' ? '⚠️' : '❌';
            return `${icon} ${name}: ${info.status}`;
        })
        .join('\n');

    const message = `🩺 **MCP Health Report** ${statusIcon}\n\n${serverLines}\n\n**Summary:** ${running} running, ${stopped} stopped, ${zombies} zombies`;

    try {
        const response = await fetch(`${HUB_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agent: 'ssan',
                name: 'Spidersan',
                message,
                glyph: '🕷️'
            })
        });

        if (response.ok) {
            console.log('📤 Posted health report to Hub chat');
        } else {
            console.log(`⚠️ Failed to post to Hub: ${response.status}`);
        }
    } catch {
        console.log('⚠️ Could not connect to Hub');
    }
}

export const mcpHealthCommand = new Command('mcp-health')
    .description('🩺 Check health of MCP servers in the ecosystem')
    .option('--json', 'Output as JSON for Hub events')
    .option('--hub', 'Post health report to Hub chat')
    .option('--kill-zombies', 'Kill duplicate MCP processes (keep only newest)')
    .option('--auto-restart', 'Automatically restart stopped required MCP servers')
    .action(async (options: { json?: boolean; hub?: boolean; killZombies?: boolean; autoRestart?: boolean }) => {
        console.log(`
🩺 MCP Health Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

        const processes = findMcpProcesses();
        const healthReport: Record<string, { status: string; pids: number[]; zombieCount: number }> = {};
        let hasIssues = false;
        let zombiesKilled = 0;
        let serversRestarted = 0;
        const stoppedServers: string[] = [];

        // Load MCP config for potential restart
        const mcpConfig = options.autoRestart ? readMcpConfig() : null;

        // Check each known server
        for (const server of KNOWN_MCP_SERVERS) {
            const procs = processes.get(server.name) || [];
            const count = procs.length;

            let status: string;
            let icon: string;

            if (count === 0) {
                if (server.required) {
                    stoppedServers.push(server.name);

                    // Try to auto-restart if flag is set
                    if (options.autoRestart && mcpConfig?.mcpServers[server.name]) {
                        const serverConfig = mcpConfig.mcpServers[server.name];
                        if (startMcpServer(server.name, serverConfig)) {
                            serversRestarted++;
                            status = 'RESTARTED';
                            icon = '🚀';
                        } else {
                            status = 'RESTART FAILED';
                            icon = '❌';
                            hasIssues = true;
                        }
                    } else {
                        status = 'NOT RUNNING';
                        icon = '❌';
                        hasIssues = true;
                    }
                } else {
                    status = 'not running (optional)';
                    icon = '⚪';
                }
            } else if (count === 1) {
                const uptime = getProcessUptime(procs[0].pid);
                status = `running (PID: ${procs[0].pid}, uptime: ${uptime})`;
                icon = '✅';
            } else {
                status = `${count} ZOMBIES FOUND!`;
                icon = '⚠️';
                hasIssues = true;

                if (options.killZombies) {
                    // Kill all but the newest (highest PID)
                    // IMPORTANT: Exclude current process and parent to avoid self-termination
                    const currentPid = process.pid;
                    const parentPid = process.ppid;
                    const protectedPids = new Set([currentPid, parentPid]);

                    const sortedProcs = [...procs].sort((a, b) => b.pid - a.pid);
                    const toKill = sortedProcs.slice(1).filter(p => !protectedPids.has(p.pid));

                    for (const proc of toKill) {
                        try {
                            execSync(`kill ${proc.pid}`, { stdio: 'ignore' });
                            zombiesKilled++;
                        } catch {
                            // Process might already be dead
                        }
                    }

                    status = `${count} found, ${toKill.length} killed (kept PID: ${sortedProcs[0].pid})`;
                    icon = '🧹';
                }
            }

            healthReport[server.name] = {
                status: count === 0 ? 'stopped' : count === 1 ? 'running' : 'zombie',
                pids: procs.map(p => p.pid),
                zombieCount: count > 1 ? count - 1 : 0
            };

            if (!options.json) {
                console.log(`${icon} ${server.name}: ${status}`);
            }
        }

        // Check for unknown MCP processes
        const unknownProcs = processes.get('unknown-mcp') || [];
        if (unknownProcs.length > 0) {
            if (!options.json) {
                console.log(`\n⚠️ Unknown MCP processes found:`);
                for (const proc of unknownProcs) {
                    console.log(`   PID ${proc.pid}: ${proc.command}`);
                }
            }
            healthReport['unknown'] = {
                status: 'unknown',
                pids: unknownProcs.map(p => p.pid),
                zombieCount: unknownProcs.length
            };
        }

        if (!options.json) {
            console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

            if (options.killZombies && zombiesKilled > 0) {
                console.log(`🧹 Killed ${zombiesKilled} zombie processes`);
            }

            if (serversRestarted > 0) {
                console.log(`🚀 Restarted ${serversRestarted} MCP server(s)`);
            }

            if (hasIssues) {
                const hints: string[] = [];
                if (stoppedServers.length > 0 && !options.autoRestart) {
                    hints.push('spidersan mcp-health --auto-restart');
                }
                hints.push('spidersan mcp-health --kill-zombies');
                console.log(`
⚠️ Issues found! Try:
   ${hints.join('\n   ')}
`);
            } else {
                console.log(`
✅ All MCP servers healthy!
`);
            }
        }

        if (options.json) {
            const event = {
                event: 'mcp:health',
                payload: {
                    servers: healthReport,
                    hasIssues,
                    zombiesKilled,
                    timestamp: new Date().toISOString()
                },
                emitter: 'spidersan'
            };
            console.log(JSON.stringify(event, null, 2));
        }

        // Post to Hub if --hub flag is set
        if (options.hub) {
            await postToHubChat(healthReport, hasIssues);
        }
    });
