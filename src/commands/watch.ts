import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import * as chokidar from 'chokidar';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';

// Config
const HUB_URL = process.env.HUB_URL || 'http://localhost:3000';
const DEBOUNCE_MS = 1000;  // Debounce file changes

interface WatchOptions {
    dir?: string;
    agent?: string;
    hub?: boolean;
    hubSync?: boolean;
    quiet?: boolean;
}

interface ConflictInfo {
    branch: string;
    files: string[];
}

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function getRepoRoot(): string {
    try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    } catch {
        return process.cwd();
    }
}

// Post conflict warning to Hub chat API
async function postConflictToChat(branch: string, agent: string, conflicts: ConflictInfo[]): Promise<void> {
    const conflictDetails = conflicts
        .map(c => `• **${c.branch}**: ${c.files.join(', ')}`)
        .join('\n');

    const message = `🕷️⚠️ **CONFLICT DETECTED** on branch \`${branch}\`\n\n${conflictDetails}`;

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

        if (!response.ok) {
            console.log(`⚠️ Failed to post to Hub chat: ${response.status}`);
        }
    } catch (err) {
        // Silently fail - Hub might not be running
    }
}

export const watchCommand = new Command('watch')
    .description('🕷️ Watch files and auto-register changes (daemon mode)')
    .option('-d, --dir <directory>', 'Directory to watch (default: current repo)')
    .option('-a, --agent <agent>', 'Agent identifier for registration')
    .option('--hub', 'Connect to Hub and emit real-time conflict warnings')
    .option('--hub-sync', 'Post conflicts to Hub chat via REST API')
    .option('-q, --quiet', 'Only log conflicts, not file changes')
    .action(async (options: WatchOptions) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branch = getCurrentBranch();
        const repoRoot = options.dir || getRepoRoot();
        const agent = options.agent || process.env.SPIDERSAN_AGENT || 'unknown';

        console.log(`
🕷️ SPIDERSAN WATCH MODE
━━━━━━━━━━━━━━━━━━━━━━━
Branch:    ${branch}
Agent:     ${agent}
Watching:  ${repoRoot}
Hub:       ${options.hub ? HUB_URL : 'disabled'}
Hub Sync:  ${options.hubSync ? 'enabled (posts to chat)' : 'disabled'}
━━━━━━━━━━━━━━━━━━━━━━━
Press Ctrl+C to stop.
        `);

        // Hub socket connection (optional)
        let hubSocket: Socket | null = null;
        if (options.hub) {
            try {
                hubSocket = io(HUB_URL, {
                    reconnection: true,
                    reconnectionAttempts: 5,
                    timeout: 5000
                });

                hubSocket.on('connect', () => {
                    console.log('🔌 Connected to Hub');
                });

                hubSocket.on('disconnect', () => {
                    console.log('🔌 Disconnected from Hub');
                });

                hubSocket.on('connect_error', (err: Error) => {
                    if (!options.quiet) {
                        console.log(`⚠️ Hub connection failed: ${err.message}`);
                    }
                });
            } catch (e) {
                console.log('⚠️ Could not connect to Hub');
            }
        }

        // Track recently changed files for debouncing
        const pendingFiles: Set<string> = new Set();
        let debounceTimer: NodeJS.Timeout | null = null;

        // Process accumulated file changes
        async function processChanges() {
            if (pendingFiles.size === 0) return;

            const files = Array.from(pendingFiles);
            pendingFiles.clear();

            // Register files
            const existing = await storage.get(branch);
            const allFiles = existing
                ? [...new Set([...existing.files, ...files])]
                : files;

            if (existing) {
                await storage.update(branch, { files: allFiles, agent });
            } else {
                await storage.register({
                    name: branch,
                    files: allFiles,
                    status: 'active',
                    agent,
                });
            }

            if (!options.quiet) {
                console.log(`📝 Registered: ${files.join(', ')}`);
            }

            // Check for conflicts
            const allBranches = await storage.list();
            const conflicts: { branch: string; files: string[] }[] = [];

            for (const otherBranch of allBranches) {
                if (otherBranch.name === branch || otherBranch.status !== 'active') continue;

                const overlapping = files.filter(f => otherBranch.files.includes(f));
                if (overlapping.length > 0) {
                    conflicts.push({ branch: otherBranch.name, files: overlapping });
                }
            }

            if (conflicts.length > 0) {
                console.log(`\n⚠️ CONFLICT DETECTED!`);
                conflicts.forEach(c => {
                    console.log(`   🔴 ${c.branch}: ${c.files.join(', ')}`);
                });
                console.log('');

                // Emit to Hub via socket if connected
                if (hubSocket?.connected) {
                    hubSocket.emit('conflicts:warning', {
                        branch,
                        agent,
                        files,
                        conflicts,
                        timestamp: new Date().toISOString()
                    });
                }

                // Post to Hub chat if --hub-sync enabled
                if (options.hubSync) {
                    await postConflictToChat(branch, agent, conflicts);
                    console.log('📤 Posted conflict to Hub chat');
                }
            }
        }

        // Start watching
        const watcher = chokidar.watch(repoRoot, {
            ignored: [
                /(^|[\/\\])\../, // dotfiles
                '**/node_modules/**',
                '**/dist/**',
                '**/*.log',
            ],
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            }
        });

        watcher.on('change', (filePath: string) => {
            const relativePath = path.relative(repoRoot, filePath);
            pendingFiles.add(relativePath);

            // Debounce: wait for more changes before processing
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processChanges, DEBOUNCE_MS);
        });

        watcher.on('add', (filePath: string) => {
            const relativePath = path.relative(repoRoot, filePath);
            pendingFiles.add(relativePath);

            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processChanges, DEBOUNCE_MS);
        });

        watcher.on('error', (err: unknown) => {
            const errorMsg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Watcher error: ${errorMsg}`);
        });

        // Handle graceful shutdown
        process.on('SIGINT', () => {
            console.log('\n🕷️ Watch mode stopped.');
            watcher.close();
            hubSocket?.disconnect();
            process.exit(0);
        });

        process.on('SIGTERM', () => {
            watcher.close();
            hubSocket?.disconnect();
            process.exit(0);
        });
    });
