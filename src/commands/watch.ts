import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import * as chokidar from 'chokidar';
import * as path from 'path';
import { io, Socket } from 'socket.io-client';
import { loadConfig } from '../lib/config.js';
import { syncFromColony } from '../lib/colony-subscriber.js';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';
const DEBOUNCE_MS = 1000;  // Debounce file changes

interface WatchOptions {
    dir?: string;
    paths?: string;
    root?: string;
    agent?: string;
    hub?: boolean;
    hubSync?: boolean;
    quiet?: boolean;
    legacy?: boolean;  // Use old behavior (more file descriptors)
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

function parsePaths(value: string): string[] {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
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
                agent: 'spidersan',
                name: 'Spidersan',
                message,
                glyph: '🕷️'
            })
        });

        if (!response.ok) {
            console.log(`⚠️ Failed to post to Hub chat: ${response.status}`);
        }
    } catch {
        // Silently fail - Hub might not be running
    }
}

export const watchCommand = new Command('watch')
    .description('🕷️ Watch files and auto-register changes (daemon mode)')
    .argument('[directory]', 'Directory to watch (default: current repo)')
    .option('-d, --dir <directory>', 'Directory to watch (alias for positional arg)')
    .option('--paths <paths>', 'Comma-separated list of files or folders to watch')
    .option('--root <root>', 'Project root for relative paths (default: git root)')
    .option('-a, --agent <agent>', 'Agent identifier for registration')
    .option('--hub', 'Connect to Hub and emit real-time conflict warnings')
    .option('--hub-sync', 'Post conflicts to Hub chat via REST API')
    .option('-q, --quiet', 'Only log conflicts, not file changes')
    .option('--legacy', 'Legacy mode: use old watcher settings (more file descriptors)')
    .action(async (directory: string | undefined, options: WatchOptions) => {
        const storage = await getStorage();
        const config = await loadConfig();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branch = getCurrentBranch();
        const repoRoot = options.root || getRepoRoot();
        const watchTargets = options.paths
            ? parsePaths(options.paths).map((entry) => path.isAbsolute(entry) ? entry : path.join(repoRoot, entry))
            : [directory || options.dir || repoRoot];
        const configuredAgent = config.agent.name?.trim();
        const agent = options.agent || process.env.SPIDERSAN_AGENT || configuredAgent || 'unknown';
        const watchLabel = watchTargets.length === 1 ? watchTargets[0] : `${watchTargets.length} paths`;

        console.log(`
🕷️ SPIDERSAN WATCH MODE
━━━━━━━━━━━━━━━━━━━━━━━
Branch:    ${branch}
Agent:     ${agent}
Root:      ${repoRoot}
Watching:  ${watchLabel}
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
            } catch {
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

            // Performance Optimization: Convert changed files to Set for O(1) lookup
            const filesSet = new Set(files);

            for (const otherBranch of allBranches) {
                if (otherBranch.name === branch || otherBranch.status !== 'active') continue;

                const overlapping = otherBranch.files.filter(f => filesSet.has(f));
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

        // Build extended ignore patterns for smart mode
        const smartIgnores = [
            '**/.next/**', '**/build/**', '**/out/**', '**/coverage/**',
            '**/.cache/**', '**/__pycache__/**', '**/target/**',
            '**/vendor/**', '**/bower_components/**', '**/.pnpm/**',
            '**/.idea/**', '**/.vscode/**', '**/*.swp', '**/*.swo',
            '**/.DS_Store', '**/Thumbs.db',
            '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml',
            '**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.ico',
            '**/*.woff', '**/*.woff2', '**/*.ttf', '**/*.pdf',
        ];
        if (options.legacy) {
            console.log('⚠️ Legacy mode: Using old watcher settings (more file descriptors)');
        }

        // Start watching
        // SECURITY FIX: Always limit depth to prevent EMFILE errors (Sherlocksan 2026-01-02)
        const watcher = chokidar.watch(watchTargets, {
            ignored: !options.legacy ? [
                ...smartIgnores,
                /(^|[/\\])\../, // dotfiles
                '**/node_modules/**',
                '**/dist/**',
                '**/*.log',
                '**/.git/**',  // ALWAYS ignore .git
            ] : [
                /(^|[/\\])\../, // dotfiles (ALWAYS ignore)
                '**/node_modules/**',
                '**/dist/**',
                '**/*.log',
                '**/.git/**',  // ALWAYS ignore .git
            ],
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 500,
                pollInterval: 100
            },
            // ALWAYS limit depth to prevent EMFILE (default: 5, legacy: 10)
            depth: !options.legacy ? 5 : 10,
            // Smart mode (default): use polling to reduce file descriptor usage
            ...(!options.legacy && {
                usePolling: true,
                interval: 1000,  // Check every 1 second
                binaryInterval: 3000,
            })
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

// ── Mode 1: Treetop Observer ──────────────────────────────────────────────────

/**
 * Default ecosystem repos to watch. Override with --repos flag or
 * SPIDERSAN_REPOS env var (colon-separated paths).
 */
const DEFAULT_TREETOP_REPOS = [
    '/Users/freedbird/Dev/Envoak',
    '/Users/freedbird/Dev/treebird-internal',
    '/Users/freedbird/Dev/spidersan-oss',
    '/Users/freedbird/Dev/Toak',
    '/Users/freedbird/Dev/flockview',
    '/Users/freedbird/Dev/mappersan',
];

interface TickResult {
    tier3: number;
    tier2: number;
    repoCount: number;
    branchCount: number;
    allIdle: boolean;
}

interface ConflictSummary {
    tier3: number;
    tier2: number;
    tier1: number;
    blocked?: boolean;
}

interface ConflictsJson {
    branch: string;
    conflicts: Array<{ tier: number; files?: string[]; branch?: string }>;
    summary: ConflictSummary;
}

/**
 * Run one full observer tick: SYNC → SCAN → TEND → SURFACE.
 * Returns tier counts and idle status for adaptive sleep calculation.
 */
async function runObserverTick(
    repos: string[],
    dryRun: boolean,
    broadcastedConflicts: Set<string>,
): Promise<TickResult> {
    let totalTier3 = 0;
    let totalTier2 = 0;
    let totalBranches = 0;
    const tier3Alerts: Array<{ repo: string; files: string[] }> = [];

    // ── STEP 1: SYNC ──────────────────────────────────────────────────────────
    // Pull colony gradient into local registry per repo.
    for (const repo of repos) {
        try {
            process.chdir(repo);
            await syncFromColony();
        } catch {
            // Repo not initialized or colony unreachable — continue
        }
    }

    // ── STEP 2: SCAN ─────────────────────────────────────────────────────────
    // Detect conflicts in each repo. spawnSync captures output even on exit 1.
    for (const repo of repos) {
        try {
            const result = spawnSync('spidersan', ['conflicts', '--json'], {
                cwd: repo,
                encoding: 'utf-8',
                timeout: 15000,
            });

            if (result.stdout) {
                const data = JSON.parse(result.stdout) as ConflictsJson;
                const summary = data.summary ?? { tier3: 0, tier2: 0, tier1: 0 };
                totalTier3 += summary.tier3 ?? 0;
                totalTier2 += summary.tier2 ?? 0;
                // Count active branches via conflicts (each conflict references another branch)
                const otherBranches = new Set(
                    data.conflicts?.map((c) => c.branch).filter(Boolean) ?? [],
                );
                totalBranches += otherBranches.size;

                if ((summary.tier3 ?? 0) > 0) {
                    const files = data.conflicts
                        .filter((c) => c.tier === 3)
                        .flatMap((c) => c.files ?? [])
                        .slice(0, 3);
                    tier3Alerts.push({ repo, files });
                }
            }
        } catch {
            // Repo not initialized or spidersan unavailable — skip
        }
    }

    // ── STEP 3: TEND ─────────────────────────────────────────────────────────
    // Colony GC (non-critical — always continue on failure).
    try {
        spawnSync('envoak', ['colony', 'gc'], { encoding: 'utf-8', timeout: 10000 });
    } catch {
        /* ignore */
    }

    // Stale check per repo (informational — no --auto-cleanup yet).
    for (const repo of repos) {
        try {
            spawnSync('spidersan', ['stale'], {
                cwd: repo,
                encoding: 'utf-8',
                timeout: 10000,
            });
        } catch {
            /* ignore */
        }
    }

    // ── STEP 4: SURFACE ───────────────────────────────────────────────────────
    // Broadcast TIER 3 alerts (deduplicated). Clear resolved conflicts.
    const currentKeys = new Set(
        tier3Alerts.map((a) => `${a.repo}:${a.files.join(',')}`),
    );

    for (const alert of tier3Alerts) {
        const key = `${alert.repo}:${alert.files.join(',')}`;
        if (!broadcastedConflicts.has(key)) {
            broadcastedConflicts.add(key);
            const repoName = path.basename(alert.repo);
            const filesStr = alert.files.length > 0 ? alert.files.join(', ') : 'multiple files';
            const message = `ssan TIER 3: conflict in ${repoName} — ${filesStr}. Halt writes on affected files.`;

            if (dryRun) {
                console.log(`[DRY-RUN] Would broadcast TIER 3 alert: ${message}`);
            } else {
                const r = spawnSync(
                    'envoak',
                    ['colony', 'broadcast', '--type', 'alert', '--message', message],
                    { encoding: 'utf-8', timeout: 10000 },
                );
                if (r.status === 0) {
                    console.log(`[TIER 3] Broadcast: ${message}`);
                } else {
                    console.error(`[TIER 3] Broadcast failed: ${r.stderr ?? r.stdout}`);
                }
            }
        }
    }

    // Evict resolved conflicts from dedup set
    for (const key of broadcastedConflicts) {
        if (!currentKeys.has(key)) {
            broadcastedConflicts.delete(key);
        }
    }

    const allIdle = totalTier3 === 0 && totalTier2 === 0 && totalBranches === 0;

    // Emit treetop heartbeat (skipped in dry-run)
    const summary =
        `Watching ${repos.length} repos, ${totalBranches} active branches. ` +
        `T3:${totalTier3} T2:${totalTier2}. GC run. Stale checked.`;
    console.log(`[TICK] ${new Date().toISOString()} — ${summary}`);

    if (!dryRun) {
        spawnSync(
            'envoak',
            ['colony', 'signal', '--status', 'idle', '--task', 'treetop watch', '--summary', summary],
            { encoding: 'utf-8', timeout: 10000 },
        );
    }

    return { tier3: totalTier3, tier2: totalTier2, repoCount: repos.length, branchCount: totalBranches, allIdle };
}

function resolveRepos(reposOption?: string): string[] {
    if (reposOption) {
        return reposOption.split(',').map((r) => r.trim()).filter(Boolean);
    }
    const envRepos = process.env['SPIDERSAN_REPOS'];
    if (envRepos) {
        return envRepos.split(':').map((r) => r.trim()).filter(Boolean);
    }
    return DEFAULT_TREETOP_REPOS;
}

function adaptiveInterval(result: TickResult, baseMs: number): number {
    if (result.tier3 > 0) return 15_000;   // Stay alert
    if (result.tier2 > 0) return 30_000;   // Watch closely
    if (result.allIdle) return 300_000;    // Colony quiet — back off
    return baseMs;
}

const watchTreetopCommand = new Command('treetop')
    .description('Mode 1: treetop observer — periodic multi-repo conflict scan + colony gradient sync')
    .option('--interval <seconds>', 'Base tick interval in seconds (default: 120)', '120')
    .option('--repos <paths>', 'Comma-separated repo paths (overrides ecosystem defaults)')
    .option('--dry-run', 'Run one tick and exit — no sleep, no colony writes')
    .action(async (options: { interval: string; repos?: string; dryRun?: boolean }) => {
        const repos = resolveRepos(options.repos);
        const baseMs = parseInt(options.interval, 10) * 1000;
        const dryRun = options.dryRun ?? false;

        console.log(`
🕷️  SPIDERSAN TREETOP OBSERVER (Mode 1)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Repos:     ${repos.length} (${repos.map((r) => path.basename(r)).join(', ')})
Interval:  ${options.interval}s base (adaptive)
Dry-run:   ${dryRun}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${dryRun ? 'Running one tick then exiting.' : 'Press Ctrl+C to stop.'}
`);

        const broadcastedConflicts = new Set<string>();

        if (dryRun) {
            await runObserverTick(repos, true, broadcastedConflicts);
            console.log('[DRY-RUN] Tick complete. Exiting.');
            return;
        }

        // Graceful shutdown
        let running = true;
        process.on('SIGINT', () => { running = false; console.log('\n🕷️  Treetop observer stopped.'); process.exit(0); });
        process.on('SIGTERM', () => { running = false; process.exit(0); });

        while (running) {
            const result = await runObserverTick(repos, false, broadcastedConflicts);
            const nextMs = adaptiveInterval(result, baseMs);
            console.log(`[SLEEP] Next tick in ${nextMs / 1000}s`);
            await new Promise<void>((resolve) => setTimeout(resolve, nextMs));
        }
    });

// Attach Mode 1 as a subcommand of watch
watchCommand.addCommand(watchTreetopCommand);
