import { Command } from 'commander';
import { io, Socket } from 'socket.io-client';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';

// Types matching watch.ts ConflictWarning
interface ConflictWarning {
    file: string;
    agents: string[];
    lines?: { [agentId: string]: [number, number] };
    tier: 1 | 2 | 3;
    resolution: 'auto-rebase' | 'manual' | 'escalate';
    timestamp: string;
}

interface AgentFileEvent {
    agent: string;
    file: string;
    action: 'editing' | 'saved' | 'closed';
    timestamp: string;
}

// Track active file edits from all agents
const activeEdits: Map<string, Set<string>> = new Map();  // file -> agents

// Time tracking for activity
const lastActivity: Map<string, number> = new Map();  // key -> timestamp

function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

function clearScreen() {
    process.stdout.write('\x1Bc');
}

function renderRadar() {
    clearScreen();
    const now = Date.now();
    const tierLabels = { 1: '⚠️ WARN', 2: '⏸️ PAUSE', 3: '🛑 BLOCK' };

    console.log(`
🕷️ SPIDERSAN CONFLICT RADAR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Real-time: who's editing what
Updated: ${new Date().toLocaleTimeString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

    // Show active edits
    if (activeEdits.size === 0) {
        console.log('  ✨ No active file edits detected');
        console.log('  (Waiting for file:changed events...)');
    } else {
        console.log('📁 ACTIVE FILES:\n');

        for (const [file, agents] of activeEdits.entries()) {
            const agentList = Array.from(agents);
            const hasConflict = agentList.length > 1;

            if (hasConflict) {
                console.log(`  🔴 ${file}`);
                console.log(`     👥 ${agentList.join(' ↔ ')} [CONFLICT!]`);
            } else {
                console.log(`  🟢 ${file}`);
                console.log(`     👤 ${agentList[0]}`);
            }
        }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Press Ctrl+C to exit');
}

export const radarCommand = new Command('radar')
    .description('🕷️ Real-time conflict radar - see who is editing what')
    .option('--hub <url>', 'Hub URL to connect to', HUB_URL)
    .action(async (options: { hub: string }) => {
        const hubUrl = options.hub;

        console.log('🕷️ Starting Conflict Radar...');
        console.log(`📡 Connecting to Hub: ${hubUrl}`);

        let socket: Socket;

        try {
            socket = io(hubUrl, {
                reconnection: true,
                reconnectionAttempts: 10,
                timeout: 5000
            });

            socket.on('connect', () => {
                console.log('🔌 Connected to Hub\n');

                // Subscribe to relevant events
                socket.emit('subscribe', {
                    events: ['file:changed', 'conflict:warning', 'agent:status']
                });

                // Start rendering
                setTimeout(renderRadar, 500);
            });

            socket.on('disconnect', () => {
                console.log('\n🔌 Disconnected from Hub');
            });

            socket.on('connect_error', (err: Error) => {
                console.log(`⚠️ Connection error: ${err.message}`);
            });

            // Listen for file change events
            socket.on('file:changed', (event: AgentFileEvent) => {
                const { agent, file, action, timestamp } = event;

                if (!activeEdits.has(file)) {
                    activeEdits.set(file, new Set());
                }

                if (action === 'editing' || action === 'saved') {
                    activeEdits.get(file)!.add(agent);
                    lastActivity.set(`${file}:${agent}`, Date.now());
                } else if (action === 'closed') {
                    activeEdits.get(file)!.delete(agent);
                    if (activeEdits.get(file)!.size === 0) {
                        activeEdits.delete(file);
                    }
                }

                renderRadar();
            });

            // Listen for conflict warnings (from watch.ts)
            socket.on('conflict:warning', (warning: ConflictWarning) => {
                const tierLabels = { 1: '⚠️ WARN', 2: '⏸️ PAUSE', 3: '🛑 BLOCK' };

                console.log(`\n${tierLabels[warning.tier]} | CONFLICT DETECTED!`);
                console.log(`   📄 File: ${warning.file}`);
                console.log(`   👥 Agents: ${warning.agents.join(' ↔ ')}`);
                console.log(`   🎯 Resolution: ${warning.resolution}`);
                console.log(`   🕐 Time: ${formatTime(warning.timestamp)}\n`);
            });

            // Simulate local file activity (for demo/testing)
            // In production, this would come from Hub
            const simulateLocalActivity = () => {
                // Just render periodically to show we're alive
                setInterval(() => {
                    // Clean up stale entries (> 60s)
                    const cutoff = Date.now() - 60000;
                    for (const [key, timestamp] of lastActivity.entries()) {
                        if (timestamp < cutoff) {
                            const [file, agent] = key.split(':');
                            activeEdits.get(file)?.delete(agent);
                            if (activeEdits.get(file)?.size === 0) {
                                activeEdits.delete(file);
                            }
                            lastActivity.delete(key);
                        }
                    }
                    renderRadar();
                }, 5000);  // Refresh every 5 seconds
            };

            simulateLocalActivity();

            // Handle graceful shutdown
            process.on('SIGINT', () => {
                console.log('\n🕷️ Radar stopped.');
                socket.disconnect();
                process.exit(0);
            });

            process.on('SIGTERM', () => {
                socket.disconnect();
                process.exit(0);
            });

        } catch (error) {
            console.error('❌ Failed to start radar:', error);
            process.exit(1);
        }
    });
