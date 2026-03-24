/**
 * spidersan doctor
 * 
 * Diagnose common issues with Spidersan setup.
 */

import { Command } from 'commander';
import { existsSync, statSync, readFileSync, readdirSync, type Dirent } from 'fs';
import { execSync, execFileSync } from 'child_process';
import { homedir } from 'os';
import { basename, join } from 'path';
import { getStorage } from '../storage/index.js';

interface Check {
    name: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
}

type RemoteStatus = 'up-to-date' | 'ahead' | 'behind' | 'diverged' | 'unrelated' | 'no remote tracking';
type RemoteRecommendation = 'push' | 'pull' | 'merge needed' | 'ok';

interface RemoteHealthRow {
    repo: string;
    status: RemoteStatus;
    ahead: number | null;
    behind: number | null;
    recommendation: RemoteRecommendation;
}

const REMOTE_SCAN_SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    'build',
    '.cache',
    '.next',
]);

function parseCount(value: string): number {
    const parsed = Number.parseInt(value.trim(), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

function formatCount(value: number | null): string {
    return value === null ? '-' : String(value);
}

function isGitRepository(repoPath: string): boolean {
    try {
        const result = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: 'pipe',
        }).trim();
        return result === 'true';
    } catch {
        return false;
    }
}

function findInitializedRepos(basePath: string, maxDepth = 3): string[] {
    const repos = new Set<string>();

    function walk(currentPath: string, depth: number): void {
        if (depth > maxDepth) return;

        let entries: Dirent<string>[];
        try {
            entries = readdirSync(currentPath, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            if (entry.name.startsWith('.')) continue;
            if (REMOTE_SCAN_SKIP_DIRS.has(entry.name)) continue;

            const fullPath = join(currentPath, entry.name);
            const registryPath = join(fullPath, '.spidersan', 'registry.json');

            if (existsSync(registryPath)) {
                if (isGitRepository(fullPath)) {
                    repos.add(fullPath);
                }
                continue;
            }

            walk(fullPath, depth + 1);
        }
    }

    walk(basePath, 0);
    return Array.from(repos).sort((a, b) => basename(a).localeCompare(basename(b)));
}

function getRemoteHealthForRepo(repoPath: string): RemoteHealthRow {
    const repo = basename(repoPath);

    try {
        const upstream = execFileSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: 'pipe',
        }).trim();
        const remote = upstream.split('/')[0] || 'origin';

        try {
            execFileSync('git', ['fetch', '--quiet', remote], {
                cwd: repoPath,
                encoding: 'utf-8',
                stdio: 'pipe',
            });
        } catch {
            // Continue with locally known remote refs if fetch fails.
        }

        let mergeBase = '';
        try {
            mergeBase = execFileSync('git', ['merge-base', 'HEAD', '@{u}'], {
                cwd: repoPath,
                encoding: 'utf-8',
                stdio: 'pipe',
            }).trim();
        } catch {
            mergeBase = '';
        }

        if (!mergeBase) {
            return {
                repo,
                status: 'unrelated',
                ahead: null,
                behind: null,
                recommendation: 'merge needed',
            };
        }

        const behind = parseCount(execFileSync('git', ['rev-list', '--count', 'HEAD..@{u}'], {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: 'pipe',
        }));
        const ahead = parseCount(execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: 'pipe',
        }));

        if (ahead === 0 && behind === 0) {
            return { repo, status: 'up-to-date', ahead, behind, recommendation: 'ok' };
        }
        if (ahead > 0 && behind > 0) {
            return { repo, status: 'diverged', ahead, behind, recommendation: 'merge needed' };
        }
        if (ahead > 0) {
            return { repo, status: 'ahead', ahead, behind, recommendation: 'push' };
        }
        return { repo, status: 'behind', ahead, behind, recommendation: 'pull' };
    } catch {
        return {
            repo,
            status: 'no remote tracking',
            ahead: null,
            behind: null,
            recommendation: 'ok',
        };
    }
}

function getRemoteHealthRows(basePath: string): RemoteHealthRow[] {
    return findInitializedRepos(basePath).map(getRemoteHealthForRepo);
}

function hasStrictRemoteFailure(rows: RemoteHealthRow[]): boolean {
    return rows.some(row => row.status === 'diverged' || row.status === 'unrelated');
}

function formatRemoteTable(rows: RemoteHealthRow[]): string[] {
    const repoWidth = Math.max('repo'.length, ...rows.map(row => row.repo.length));
    const statusWidth = Math.max('status'.length, ...rows.map(row => row.status.length));
    const aheadWidth = Math.max('ahead'.length, ...rows.map(row => formatCount(row.ahead).length));
    const behindWidth = Math.max('behind'.length, ...rows.map(row => formatCount(row.behind).length));
    const recWidth = Math.max('recommendation'.length, ...rows.map(row => row.recommendation.length));

    const header = `  ${'repo'.padEnd(repoWidth)} | ${'status'.padEnd(statusWidth)} | ` +
        `${'ahead'.padEnd(aheadWidth)} | ${'behind'.padEnd(behindWidth)} | ${'recommendation'.padEnd(recWidth)}`;
    const divider = `  ${'-'.repeat(repoWidth)}-+-${'-'.repeat(statusWidth)}-+-${'-'.repeat(aheadWidth)}-+-` +
        `${'-'.repeat(behindWidth)}-+-${'-'.repeat(recWidth)}`;
    const body = rows.map((row) =>
        `  ${row.repo.padEnd(repoWidth)} | ${row.status.padEnd(statusWidth)} | ` +
        `${formatCount(row.ahead).padEnd(aheadWidth)} | ${formatCount(row.behind).padEnd(behindWidth)} | ` +
        `${row.recommendation.padEnd(recWidth)}`
    );

    return [header, divider, ...body];
}

function checkGitContext(): Check {
    try {
        execSync('git rev-parse --git-dir', { stdio: 'ignore' });
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
        return { name: 'Git Context', status: 'ok', message: `In git repo, branch: ${branch}` };
    } catch {
        return { name: 'Git Context', status: 'warn', message: 'Not in a git repository' };
    }
}

function checkLocalStorage(): Check {
    const localPath = join(process.cwd(), '.spidersan', 'registry.json');
    if (existsSync(localPath)) {
        const stats = statSync(localPath);
        return { name: 'Local Storage', status: 'ok', message: `Found (.spidersan/registry.json, ${stats.size} bytes)` };
    }
    return { name: 'Local Storage', status: 'warn', message: 'Not initialized locally (run: spidersan init)' };
}

function checkGlobalStorage(): Check {
    const globalPath = join(homedir(), '.spidersan', 'registry.json');
    if (existsSync(globalPath)) {
        const stats = statSync(globalPath);
        return { name: 'Global Storage', status: 'ok', message: `Found (~/.spidersan/registry.json, ${stats.size} bytes)` };
    }
    return { name: 'Global Storage', status: 'warn', message: 'No global registry' };
}

function checkEnvConflict(): Check {
    const localEnv = join(process.cwd(), '.env');
    if (existsSync(localEnv)) {
        try {
            const content = readFileSync(localEnv, 'utf-8');

            // Check for concatenation bug (missing newlines between vars)
            // Pattern: VALUE without newline before next KEY=
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Check for multiple = on same line (concatenation bug)
                const equalSigns = (line.match(/=/g) || []).length;
                if (equalSigns > 1 && !line.startsWith('#')) {
                    return {
                        name: '.env Lint',
                        status: 'error',
                        message: `.env line ${i + 1} has multiple '=' - likely missing newline (concatenation bug)`
                    };
                }
                // Check for vars that look concatenated (e.g., VALUE_WITHOUT_NEWLINENEXT_VAR=)
                if (line.includes('://') && line.includes('=') && line.indexOf('=') < line.indexOf('://')) {
                    // URL in value is fine, but check if there's another = after
                    const afterUrl = line.substring(line.indexOf('://') + 3);
                    if (afterUrl.includes('=') && !afterUrl.startsWith('=')) {
                        return {
                            name: '.env Lint',
                            status: 'error',
                            message: `.env line ${i + 1} appears corrupted - check for missing newlines`
                        };
                    }
                }
            }

            // Check Supabase conflict (skip comment lines)
            const nonCommentLines = content.split('\n').filter(l => !l.trim().startsWith('#')).join('\n');
            if (nonCommentLines.includes('SUPABASE_URL') || nonCommentLines.includes('SUPABASE_KEY')) {
                return {
                    name: '.env Lint',
                    status: 'warn',
                    message: 'Local .env has Supabase vars - may conflict with mycmail'
                };
            }
        } catch {
            // Ignore read errors
        }
    }
    return { name: '.env Lint', status: 'ok', message: 'No .env issues detected' };
}

function checkMycmail(): Check {
    try {
        execSync('which mycmail', { stdio: 'ignore' });
        const version = execSync('mycmail --version 2>/dev/null || echo "unknown"', { encoding: 'utf-8' }).trim();
        return { name: 'Myceliumail', status: 'ok', message: `Installed (${version})` };
    } catch {
        return { name: 'Myceliumail', status: 'warn', message: 'Not installed (optional)' };
    }
}

async function checkStaleBranches(): Promise<Check> {
    try {
        const storage = await getStorage();
        if (!await storage.isInitialized()) {
            return { name: 'Stale Branches', status: 'warn', message: 'Storage not initialized' };
        }

        const branches = await storage.list();
        const stale = branches.filter(b => {
            const age = Date.now() - new Date(b.registeredAt).getTime();
            return age > 7 * 24 * 60 * 60 * 1000; // 7 days
        });

        if (stale.length > 0) {
            return { name: 'Stale Branches', status: 'warn', message: `${stale.length} branch(es) older than 7 days` };
        }
        return { name: 'Stale Branches', status: 'ok', message: 'No stale branches' };
    } catch {
        return { name: 'Stale Branches', status: 'error', message: 'Could not check' };
    }
}

function checkGitignore(): Check {
    const gitignorePath = join(process.cwd(), '.gitignore');
    if (!existsSync(gitignorePath)) {
        return { name: '.gitignore Check', status: 'warn', message: 'No .gitignore file found' };
    }

    try {
        const content = readFileSync(gitignorePath, 'utf-8');
        const missing: string[] = [];

        // Essential patterns that should be in .gitignore
        const essentialPatterns = [
            { pattern: '.env', description: 'env files' },
            { pattern: 'node_modules', description: 'node_modules' },
            { pattern: '*.key', description: 'key files' },
        ];

        // ⚡ Bolt: Hoist string splitting outside the loop to prevent redundant allocations
        const lines = content.split('\n');

        for (const { pattern, description } of essentialPatterns) {
            // Check if pattern or similar is present
            const hasPattern = lines.some((line: string) => {
                const trimmed = line.trim();
                return !trimmed.startsWith('#') &&
                    (trimmed === pattern ||
                        trimmed.startsWith(pattern) ||
                        trimmed.includes(pattern));
            });
            if (!hasPattern) {
                missing.push(description);
            }
        }

        if (missing.length > 0) {
            return {
                name: '.gitignore Check',
                status: 'warn',
                message: `Missing patterns: ${missing.join(', ')}`
            };
        }
        return { name: '.gitignore Check', status: 'ok', message: 'Essential patterns present' };
    } catch {
        return { name: '.gitignore Check', status: 'error', message: 'Could not read .gitignore' };
    }
}

function checkErrorLogs(): Check {
    const errorsDir = join(homedir(), '.agent-errors');
    if (!existsSync(errorsDir)) {
        return { name: 'Error Logs', status: 'ok', message: 'No agent errors logged' };
    }

    try {
        const files = readdirSync(errorsDir).filter(f => f.endsWith('.log') && !f.includes('.log.'));
        if (files.length === 0) {
            return { name: 'Error Logs', status: 'ok', message: 'No agent errors logged' };
        }

        let totalErrors = 0;
        let recentErrors = 0;
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;

        for (const file of files) {
            const content = readFileSync(join(errorsDir, file), 'utf-8');
            const lines = content.trim().split('\n').filter(l => l);
            totalErrors += lines.length;

            // Count recent errors (last hour)
            for (const line of lines.slice(-20)) {
                try {
                    const entry = JSON.parse(line);
                    if (now - new Date(entry.timestamp).getTime() < oneHour) {
                        recentErrors++;
                    }
                } catch {
                    // Skip malformed lines
                }
            }
        }

        if (recentErrors > 0) {
            return {
                name: 'Error Logs',
                status: 'warn',
                message: `${recentErrors} error(s) in last hour (${totalErrors} total in ${files.length} agent(s))`
            };
        }

        return {
            name: 'Error Logs',
            status: 'ok',
            message: `${totalErrors} logged error(s) across ${files.length} agent(s)`
        };
    } catch {
        return { name: 'Error Logs', status: 'error', message: 'Could not read error logs' };
    }
}

function checkEmfileLimit(): Check {
    try {
        const limit = parseInt(execSync('ulimit -n', { encoding: 'utf-8' }).trim(), 10);
        if (limit < 2048) {
            return {
                name: 'File Limits',
                status: 'warn',
                message: `ulimit -n is ${limit} (recommended: 2048+ for large repos)`
            };
        }
        return { name: 'File Limits', status: 'ok', message: `ulimit -n is ${limit}` };
    } catch {
        return { name: 'File Limits', status: 'warn', message: 'Could not check ulimit' };
    }
}

function checkWatcherStatus(): Check {
    try {
        const output = execFileSync('ps', ['aux'], { encoding: 'utf-8', stdio: 'pipe' });
        const hasWatcher = output.split('\n').some((line) => line.includes('spidersan watch'));
        if (hasWatcher) {
            return { name: 'Watcher Daemon', status: 'ok', message: 'Running' };
        }
        return { name: 'Watcher Daemon', status: 'warn', message: 'Not running (run: spidersan watch)' };
    } catch {
        return { name: 'Watcher Daemon', status: 'warn', message: 'Not running (run: spidersan watch)' };
    }
}

function checkNodeVersion(): Check {
    const version = process.version;
    const major = parseInt(version.replace('v', '').split('.')[0], 10);

    if (major < 18) {
        return { name: 'Node Version', status: 'error', message: `${version} (Requires Node 18+)` };
    }
    return { name: 'Node Version', status: 'ok', message: `${version}` };
}

export const doctorCommand = new Command('doctor')
    .description('Diagnose common Spidersan issues')
    .option('--json', 'Output as JSON')
    .option('--remote', 'Check remote sync health across initialized repositories')
    .option('--strict', 'With --remote, exit 1 if any repository is diverged')
    .action(async (options) => {
        if (options.remote) {
            const basePath = join(homedir(), 'Dev');
            const remoteRows = getRemoteHealthRows(basePath);
            const strictFailure = options.strict && hasStrictRemoteFailure(remoteRows);

            if (options.json) {
                console.log(JSON.stringify(remoteRows, null, 2));
                if (strictFailure) {
                    process.exit(1);
                }
                return;
            }

            console.log(`\n🕷️ Remote Sync Health — ${remoteRows.length} repos checked\n`);

            if (remoteRows.length === 0) {
                console.log('  ⚠️  No initialized repositories found under ~/Dev');
                console.log('');
                return;
            }

            for (const line of formatRemoteTable(remoteRows)) {
                console.log(line);
            }

            const pushNeeded = remoteRows.filter(row => row.recommendation === 'push').length;
            const pullNeeded = remoteRows.filter(row => row.recommendation === 'pull').length;
            const mergeNeeded = remoteRows.filter(row => row.recommendation === 'merge needed').length;
            const upToDate = remoteRows.filter(row => row.status === 'up-to-date').length;
            const noTracking = remoteRows.filter(row => row.status === 'no remote tracking').length;

            console.log('');
            console.log(
                `Summary: ${pushNeeded} push needed, ${pullNeeded} pull needed, ` +
                `${mergeNeeded} merge needed, ${upToDate} up-to-date, ${noTracking} no remote tracking`
            );

            if (strictFailure) {
                console.log('❌ Strict mode: diverged/unrelated repositories found');
                process.exit(1);
            }

            console.log('');
            return;
        }

        const checks: Check[] = [
            checkGitContext(),
            checkLocalStorage(),
            checkGlobalStorage(),
            checkEnvConflict(),
            checkGitignore(),
            checkErrorLogs(),
            checkMycmail(),
            checkEmfileLimit(),
            checkWatcherStatus(),
            checkNodeVersion(),
            await checkStaleBranches(),
        ];

        if (options.json) {
            console.log(JSON.stringify(checks, null, 2));
            return;
        }

        console.log('\n🕷️ Spidersan Doctor\n');

        const icons = { ok: '✅', warn: '⚠️ ', error: '❌' };

        for (const check of checks) {
            console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
        }

        const errors = checks.filter(c => c.status === 'error').length;
        const warnings = checks.filter(c => c.status === 'warn').length;

        console.log('');
        if (errors > 0) {
            console.log(`  ❌ ${errors} error(s), ${warnings} warning(s)`);
            process.exit(1);
        } else if (warnings > 0) {
            console.log(`  ⚠️  ${warnings} warning(s), but no critical issues`);
        } else {
            console.log('  ✅ All checks passed!');
        }
        console.log('');
    });

export const _doctorTestable = {
    findInitializedRepos,
    getRemoteHealthForRepo,
    getRemoteHealthRows,
    hasStrictRemoteFailure,
    formatRemoteTable,
};
