/**
 * spidersan auto
 *
 * Start/stop auto-watch sessions based on config.
 */

import { Command } from 'commander';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadConfig } from '../lib/config.js';

interface AutoWatchState {
    pid: number;
    startedAt: string;
    repoRoot: string;
    paths: string[];
    agent?: string;
    hub: boolean;
    hubSync: boolean;
    quiet: boolean;
    legacy: boolean;
}

function getRepoRoot(): string {
    try {
        return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
    } catch {
        return process.cwd();
    }
}

function getStatePath(repoRoot: string): string {
    return join(repoRoot, '.spidersan', 'auto-watch.json');
}

function ensureStateDir(repoRoot: string): void {
    const dir = join(repoRoot, '.spidersan');
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

function parsePaths(value: string): string[] {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readState(statePath: string): AutoWatchState | null {
    if (!existsSync(statePath)) return null;
    try {
        const content = readFileSync(statePath, 'utf-8');
        return JSON.parse(content) as AutoWatchState;
    } catch {
        return null;
    }
}

function stopProcess(pid: number): void {
    try {
        if (process.platform !== 'win32') {
            process.kill(-pid);
        } else {
            process.kill(pid);
        }
    } catch {
        // ignore kill errors
    }
}

export const autoCommand = new Command('auto')
    .description('Auto-watch shortcuts (start/stop)');

autoCommand
    .command('start')
    .description('Start auto-watch in the background')
    .option('--paths <paths>', 'Comma-separated list of files or folders to watch')
    .option('--agent <agent>', 'Agent identifier for registration')
    .option('--hub', 'Connect to Hub and emit real-time conflict warnings')
    .option('--hub-sync', 'Post conflicts to Hub chat via REST API')
    .option('--quiet', 'Only log conflicts, not file changes')
    .option('--legacy', 'Legacy mode: use old watcher settings')
    .option('--force', 'Start even if autoWatch is disabled in config')
    .action(async (options) => {
        const repoRoot = getRepoRoot();
        const statePath = getStatePath(repoRoot);
        ensureStateDir(repoRoot);

        const existing = readState(statePath);
        if (existing && isProcessRunning(existing.pid)) {
            console.log('🕷️ Auto-watch is already running.');
            console.log(`   PID: ${existing.pid}`);
            console.log(`   Paths: ${existing.paths.join(', ')}`);
            return;
        }

        const config = await loadConfig();
        const autoConfig = config.autoWatch;
        const configEnabled = autoConfig.enabled;
        const cliPaths = options.paths ? parsePaths(options.paths) : [];

        if (!configEnabled && cliPaths.length === 0 && !options.force) {
            console.error('❌ Auto-watch is disabled in config.');
            console.error('   Enable it in .spidersanrc or pass --paths / --force.');
            return;
        }

        const paths = cliPaths.length > 0 ? cliPaths : autoConfig.paths;
        if (paths.length === 0) {
            console.error('❌ No auto-watch paths configured.');
            console.error('   Set autoWatch.paths in .spidersanrc or pass --paths.');
            return;
        }

        const configuredAgent = config.agent.name?.trim();
        const agent = (options.agent || process.env.SPIDERSAN_AGENT || configuredAgent || 'unknown').trim();

        const hub = Boolean(options.hub || autoConfig.hub);
        const hubSync = Boolean(options.hubSync || autoConfig.hubSync);
        const quiet = Boolean(options.quiet || autoConfig.quiet);
        const legacy = Boolean(options.legacy || autoConfig.legacy);

        const script = process.argv[1];
        if (!script) {
            console.error('❌ Could not resolve CLI script path.');
            return;
        }

        const args = [
            script,
            'watch',
            '--root',
            repoRoot,
            '--paths',
            paths.join(','),
            '--agent',
            agent,
        ];

        if (hub) args.push('--hub');
        if (hubSync) args.push('--hub-sync');
        if (quiet) args.push('--quiet');
        if (legacy) args.push('--legacy');

        const child = spawn(process.execPath, args, {
            cwd: repoRoot,
            detached: true,
            stdio: 'ignore',
            env: process.env,
        });

        if (!child.pid) {
            console.error('❌ Failed to start auto-watch.');
            return;
        }

        child.unref();

        const state: AutoWatchState = {
            pid: child.pid,
            startedAt: new Date().toISOString(),
            repoRoot,
            paths,
            agent,
            hub,
            hubSync,
            quiet,
            legacy,
        };

        writeFileSync(statePath, JSON.stringify(state, null, 2));

        console.log('🕷️ Auto-watch started.');
        console.log(`   PID: ${child.pid}`);
        console.log(`   Paths: ${paths.join(', ')}`);
        console.log('   Stop with: spidersan auto stop');
    });

autoCommand
    .command('stop')
    .description('Stop the running auto-watch session')
    .action(() => {
        const repoRoot = getRepoRoot();
        const statePath = getStatePath(repoRoot);
        const state = readState(statePath);

        if (!state) {
            console.log('🕷️ No auto-watch session found.');
            return;
        }

        if (isProcessRunning(state.pid)) {
            stopProcess(state.pid);
            console.log(`🕷️ Stopped auto-watch (PID ${state.pid}).`);
        } else {
            console.log('🕷️ Auto-watch process not running (stale state).');
        }

        try {
            rmSync(statePath);
        } catch {
            // ignore
        }
    });

autoCommand
    .command('status')
    .description('Show auto-watch status')
    .action(() => {
        const repoRoot = getRepoRoot();
        const statePath = getStatePath(repoRoot);
        const state = readState(statePath);

        if (!state) {
            console.log('🕷️ Auto-watch is not running.');
            return;
        }

        const running = isProcessRunning(state.pid);
        console.log(`🕷️ Auto-watch ${running ? 'running' : 'stopped'}`);
        console.log(`   PID: ${state.pid}`);
        console.log(`   Paths: ${state.paths.join(', ')}`);
        console.log(`   Agent: ${state.agent || 'unknown'}`);
        console.log(`   Hub: ${state.hub ? 'enabled' : 'disabled'}`);
        console.log(`   Hub Sync: ${state.hubSync ? 'enabled' : 'disabled'}`);
        console.log(`   Quiet: ${state.quiet ? 'enabled' : 'disabled'}`);
        console.log(`   Legacy: ${state.legacy ? 'enabled' : 'disabled'}`);
        console.log(`   Started: ${state.startedAt}`);
    });
