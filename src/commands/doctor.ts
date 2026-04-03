/**
 * spidersan doctor
 * 
 * Diagnose common issues with Spidersan setup.
 */

import { Command } from 'commander';
import { existsSync, statSync, readFileSync, readdirSync, type Dirent } from 'fs';
import { execFileSync } from 'child_process';
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
        execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
        const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
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
            let hasSupabaseVars = false;

            // Performance Optimization: Single-pass primitive lookup avoids O(N) array allocation
            // and chained method overhead from split('\n'), match(/=/g), filter, and join.
            let start = 0;
            let lineNumber = 1;
            const length = content.length;

            while (start < length) {
                let end = content.indexOf('\n', start);
                if (end === -1) end = length;

                const line = content.substring(start, end);
                const trimmed = line.trimStart();

                if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                    // Check for multiple = on same line (concatenation bug)
                    let equalCount = 0;
                    let equalIndex = line.indexOf('=');

                    while (equalIndex !== -1) {
                        // Heuristic: exclude = if preceded by ? or & (likely URL params)
                        if (equalIndex === 0 || (line[equalIndex - 1] !== '?' && line[equalIndex - 1] !== '&')) {
                            equalCount++;
                        }
                        equalIndex = line.indexOf('=', equalIndex + 1);
                    }

                    if (equalCount > 1) {
                        return {
                            name: '.env Lint',
                            status: 'error',
                            message: `.env line ${lineNumber} has multiple '=' - likely missing newline (concatenation bug)`
                        };
                    }

                    // Check for vars that look concatenated (e.g., VALUE_WITHOUT_NEWLINENEXT_VAR=)
                    const urlIdx = line.indexOf('://');
                    const eqIdx = line.indexOf('=');
                    if (urlIdx !== -1 && eqIdx !== -1 && eqIdx < urlIdx) {
                        // URL in value is fine, but check if there's another = after
                        const afterUrl = line.substring(urlIdx + 3);
                        if (afterUrl.includes('=') && !afterUrl.startsWith('=')) {
                            return {
                                name: '.env Lint',
                                status: 'error',
                                message: `.env line ${lineNumber} appears corrupted - check for missing newlines`
                            };
                        }
                    }

                    // Check Supabase conflict
                    if (line.includes('SUPABASE_URL') || line.includes('SUPABASE_KEY')) {
                        hasSupabaseVars = true;
                    }
                }

                start = end + 1;
                lineNumber++;
            }

            if (hasSupabaseVars) {
                return {
                    name: '.env Lint',
                    status: 'warn',
                    message: 'Local .env has Supabase vars - check configuration'
                };
            }
        } catch {
            // Ignore read errors
        }
    }
    return { name: '.env Lint', status: 'ok', message: 'No .env issues detected' };
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

        // Performance Optimization: Single-pass primitive lookup avoids O(N) array allocation
        // and chained method overhead from split('\n').some(...)
        for (const { pattern, description } of essentialPatterns) {
            let pos = content.indexOf(pattern);
            let found = false;

            while (pos !== -1) {
                // Walk backward to the start of the line to check for comment markers
                let lineStart = pos;
                while (lineStart > 0 && content[lineStart - 1] !== '\n') {
                    lineStart--;
                }

                // Skip leading whitespace to find the first character of the line
                let i = lineStart;
                while (i < pos && (content[i] === ' ' || content[i] === '\t')) {
                    i++;
                }

                if (content[i] !== '#') {
                    found = true;
                    break;
                }
                pos = content.indexOf(pattern, pos + 1);
            }

            if (!found) {
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
            const length = content.length;
            if (length === 0) continue;

            // Performance Optimization: Count lines manually to avoid O(N) memory allocation
            // of `content.trim().split('\n').filter(...)`
            let lineCount = 0;
            let pos = 0;
            while (pos < length) {
                let nextPos = content.indexOf('\n', pos);
                if (nextPos === -1) nextPos = length;

                // Only count non-empty lines (ignoring just spaces/tabs)
                let isEmpty = true;
                for (let i = pos; i < nextPos; i++) {
                    if (content[i] !== ' ' && content[i] !== '\t' && content[i] !== '\r') {
                        isEmpty = false;
                        break;
                    }
                }
                if (!isEmpty) lineCount++;
                pos = nextPos + 1;
            }
            totalErrors += lineCount;

            // Performance Optimization: To read the last 20 lines, parse backwards from the end
            let n = 20;
            let lastPos = length - 1;
            while (lastPos >= 0 && n > 0) {
                lastPos = content.lastIndexOf('\n', lastPos - 1);
                n--;
            }

            const recentLinesStr = lastPos >= 0 ? content.substring(lastPos + 1) : content;
            let recentPos = 0;
            const recentLength = recentLinesStr.length;

            while (recentPos < recentLength) {
                let nextRecent = recentLinesStr.indexOf('\n', recentPos);
                if (nextRecent === -1) nextRecent = recentLength;

                const line = recentLinesStr.substring(recentPos, nextRecent).trim();
                if (line) {
                    try {
                        const entry = JSON.parse(line);
                        if (now - new Date(entry.timestamp).getTime() < oneHour) {
                            recentErrors++;
                        }
                    } catch {
                        // Skip malformed lines
                    }
                }
                recentPos = nextRecent + 1;
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
        const limit = parseInt(execFileSync('sh', ['-c', 'ulimit -n'], { encoding: 'utf-8' }).trim(), 10);
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
