import { Command } from 'commander';
import { io, Socket } from 'socket.io-client';
import { SpidersanDashboard } from '../tui/dashboard.js';
import { getStorage } from '../storage/index.js';
import { createSwarmState, SwarmState } from '../lib/crdt.js';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';
const AGENT_ID = process.env.SPIDERSAN_AGENT || 'monitor-daemon';

export const monitorCommand = new Command('monitor')
    .description('🕷️ Real-time Hub Monitor Dashboard')
    .option('--hub <url>', 'Hub URL to connect to', HUB_URL)
    .action(async (options: { hub: string }) => {
        const dashboard = new SpidersanDashboard();
        dashboard.render(); // Initial render

        // CRDT State
        const swarmState = createSwarmState(AGENT_ID);

        // Refresh dashboard when CRDT state changes
        swarmState.doc.on('update', () => {
            const locks = swarmState.getAllLocks().map(l => ({
                symbol: l.symbolId,
                agent: l.agentId,
                time: l.timestamp
            }));
            dashboard.updateState({ activeLocks: locks });
        });

        try {
            // 1. Connect to Hub
            dashboard.addLog(`Connecting to Hub: ${options.hub}...`);
            const socket: Socket = io(options.hub, {
                reconnection: true,
                timeout: 5000
            });

            const connectedAgents = new Set<string>();

            socket.on('connect', () => {
                dashboard.addLog('✅ Connected to Hub');
                dashboard.updateState({ connectedAgents: Array.from(connectedAgents) });

                socket.emit('subscribe', {
                    events: ['file:changed', 'task:updated', 'agent:heartbeat', 'crdt:update', 'crdt:state']
                });

                // Request initial CRDT state
                socket.emit('crdt:request-state');
            });

            socket.on('disconnect', () => {
                dashboard.addLog('❌ Disconnected from Hub');
                connectedAgents.clear();
                dashboard.updateState({ connectedAgents: [] });
            });

            socket.on('connect_error', (err: Error) => {
                dashboard.addLog(`⚠️ Connection error: ${err.message}`);
            });

            // 2. Listen for Events

            // CRDT Sync
            socket.on('crdt:update', (data: { update: string, agent: string }) => {
                const update = new Uint8Array(Buffer.from(data.update, 'base64'));
                swarmState.applyUpdate(update);
            });

            socket.on('crdt:state', (data: { updates: string[] }) => {
                dashboard.addLog(`📦 Received State (${data.updates.length} chunks)`);
                for (const chunk of data.updates) {
                    const update = new Uint8Array(Buffer.from(chunk, 'base64'));
                    swarmState.applyUpdate(update);
                }
            });

            // Heartbeats
            socket.on('agent:heartbeat', (data: { agent: string }) => {
                if (!connectedAgents.has(data.agent)) {
                    connectedAgents.add(data.agent);
                    dashboard.addLog(`👋 Agent joined: ${data.agent}`);
                    dashboard.updateState({ connectedAgents: Array.from(connectedAgents) });
                }
            });

            // File Changes (Conflict Radar)
            const activeFiles = new Map<string, string[]>();

            socket.on('file:changed', (data: { file: string, agent: string, action: string }) => {
                if (data.action === 'editing') {
                    const agents = activeFiles.get(data.file) || [];
                    if (!agents.includes(data.agent)) {
                        agents.push(data.agent);
                        activeFiles.set(data.file, agents);
                        dashboard.addLog(`✏️ ${data.agent} editing ${data.file}`);
                    }
                } else if (data.action === 'closed' || data.action === 'saved') {
                    const agents = activeFiles.get(data.file) || [];
                    const newAgents = agents.filter(a => a !== data.agent);
                    if (newAgents.length === 0) {
                        activeFiles.delete(data.file);
                    } else {
                        activeFiles.set(data.file, newAgents);
                    }
                    dashboard.addLog(`💾 ${data.agent} ${data.action} ${data.file}`);
                }

                dashboard.updateState({ activeFiles });
            });

            // Task Updates (Formation)
            socket.on('task:updated', (task: { id: string, title: string, owner: string, status: string }) => {
                // In a real app we'd merge this into a map, for now just log
                dashboard.addLog(`📋 Task Update: ${task.title} -> ${task.status}`);
            });

            // 3. Local Polling (Backup if Hub is quiet)
            // Just to show some activity in the demo if no other agents are online
            setInterval(() => {
                dashboard.render(); // Keep clock updating
            }, 1000);

            // Access local storage to show local branches as a baseline
            try {
                const storage = await getStorage();
                const branches = await storage.list();
                if (branches.length > 0) {
                    dashboard.addLog(`📚 Loaded ${branches.length} local branches`);
                    // We could visualize these, but Monitor is mainly for Hub state
                }
            } catch (e) {
                // ignore
            }

        } catch (error) {
            dashboard.addLog(`❌ Fatal error: ${error}`);
        }
    });
