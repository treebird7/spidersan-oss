/**
 * spidersan sync-all
 * 
 * Scan and sync all /Dev repositories.
 * Global git coordination for the entire ecosystem.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { existsSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

interface RepoStatus {
    name: string;
    path: string;
    uncommitted: number;
    unpushed: number;
    behind: number;
    branch: string;
    error?: string;
}

interface SyncAllOptions {
    pull?: boolean;
    push?: boolean;
    status?: boolean;
    json?: boolean;
    repos?: string;
}

const DEV_DIR = '/Users/freedbird/Dev';

function runGitInRepo(repoPath: string, cmd: string): { success: boolean; output: string } {
    try {
        const output = execSync(`git ${cmd}`, {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: 'pipe'
        }).trim();
        return { success: true, output };
    } catch (error: unknown) {
        const output = error instanceof Error && 'stdout' in error
            ? (error as { stdout: string }).stdout?.trim() || ''
            : '';
        return { success: false, output };
    }
}

function discoverRepos(baseDir: string): string[] {
    const repos: string[] = [];

    try {
        const entries = readdirSync(baseDir);

        for (const entry of entries) {
            const fullPath = join(baseDir, entry);

            // Skip non-directories
            if (!statSync(fullPath).isDirectory()) continue;

            // Skip hidden directories except .git
            if (entry.startsWith('.') && entry !== '.git') continue;

            // Check if it's a git repo
            const gitPath = join(fullPath, '.git');
            if (existsSync(gitPath)) {
                repos.push(fullPath);
            }
        }
    } catch {
        // Directory doesn't exist or can't be read
    }

    return repos.sort();
}

function getRepoStatus(repoPath: string): RepoStatus {
    const name = basename(repoPath);
    const status: RepoStatus = {
        name,
        path: repoPath,
        uncommitted: 0,
        unpushed: 0,
        behind: 0,
        branch: 'unknown'
    };

    // Get current branch
    const branchResult = runGitInRepo(repoPath, 'rev-parse --abbrev-ref HEAD');
    if (branchResult.success) {
        status.branch = branchResult.output;
    }

    // Count uncommitted changes
    const statusResult = runGitInRepo(repoPath, 'status --porcelain');
    if (statusResult.success) {
        const lines = statusResult.output.split('\n').filter(Boolean);
        status.uncommitted = lines.length;
    }

    // Count unpushed commits
    const unpushedResult = runGitInRepo(repoPath, 'log @{u}..HEAD --oneline');
    if (unpushedResult.success) {
        const lines = unpushedResult.output.split('\n').filter(Boolean);
        status.unpushed = lines.length;
    }

    // Count behind remote
    const behindResult = runGitInRepo(repoPath, 'log HEAD..@{u} --oneline');
    if (behindResult.success) {
        const lines = behindResult.output.split('\n').filter(Boolean);
        status.behind = lines.length;
    }

    return status;
}

export const syncAllCommand = new Command('sync-all')
    .description('Scan and sync all /Dev repositories')
    .option('--status', 'Show status of all repos (default)')
    .option('--pull', 'Pull all repos from remote')
    .option('--push', 'Push all repos to remote')
    .option('--repos <names>', 'Comma-separated repo names to sync')
    .option('--json', 'Output as JSON')
    .addHelpText('after', `
Examples:
  $ spidersan sync-all                    # Show status of all repos
  $ spidersan sync-all --pull             # Pull all repos
  $ spidersan sync-all --push             # Push all repos with commits
  $ spidersan sync-all --pull --push      # Full sync cycle
  $ spidersan sync-all --repos "Envoak,Sherlocksan" --pull
`)
    .action(async (options: SyncAllOptions) => {
        // Default to status if no action specified
        const showStatus = options.status || (!options.pull && !options.push);

        // Discover repos
        let repos = discoverRepos(DEV_DIR);

        // Filter by name if specified
        if (options.repos) {
            const filterNames = options.repos.split(',').map(n => n.trim().toLowerCase());
            repos = repos.filter(r => filterNames.includes(basename(r).toLowerCase()));
        }

        if (repos.length === 0) {
            console.log('🕷️ No repositories found.');
            return;
        }

        const statuses: RepoStatus[] = [];

        if (!options.json) {
            console.log(`\n🕷️ SYNC-ALL — ${repos.length} repositories\n`);
            console.log('━'.repeat(50));
        }

        for (const repoPath of repos) {
            const name = basename(repoPath);
            let status = getRepoStatus(repoPath);

            // Pull if requested
            if (options.pull) {
                if (!options.json) process.stdout.write(`📥 ${name}: pulling... `);
                const result = runGitInRepo(repoPath, 'pull --rebase');
                if (!options.json) {
                    console.log(result.success ? '✅' : '⚠️');
                }
                // Refresh status after pull
                status = getRepoStatus(repoPath);
            }

            // Push if requested and has unpushed commits
            if (options.push && status.unpushed > 0) {
                if (!options.json) process.stdout.write(`📤 ${name}: pushing ${status.unpushed} commit(s)... `);
                const result = runGitInRepo(repoPath, 'push');
                if (!options.json) {
                    console.log(result.success ? '✅' : '⚠️');
                }
                // Refresh status after push
                status = getRepoStatus(repoPath);
            }

            statuses.push(status);

            // Show status
            if (showStatus && !options.json) {
                let icon = '✅';
                if (status.uncommitted > 0) icon = '📝';
                if (status.unpushed > 0) icon = '📤';
                if (status.behind > 0) icon = '📥';
                if (status.uncommitted > 0 && status.behind > 0) icon = '⚠️';

                console.log(`${icon} ${name.padEnd(20)} ${status.branch.padEnd(10)} | ${status.uncommitted} uncommitted | ${status.unpushed} unpushed | ${status.behind} behind`);
            }
        }

        if (options.json) {
            console.log(JSON.stringify({ repos: statuses }, null, 2));
            return;
        }

        console.log('━'.repeat(50));

        // Summary
        const withUncommitted = statuses.filter(s => s.uncommitted > 0).length;
        const withUnpushed = statuses.filter(s => s.unpushed > 0).length;
        const withBehind = statuses.filter(s => s.behind > 0).length;
        const clean = statuses.filter(s => s.uncommitted === 0 && s.unpushed === 0 && s.behind === 0).length;

        console.log(`\n📊 Summary: ${clean} clean | ${withUncommitted} uncommitted | ${withUnpushed} unpushed | ${withBehind} behind`);

        if (withBehind > 0 && !options.pull) {
            console.log('\n💡 Run: spidersan sync-all --pull');
        }
        if (withUnpushed > 0 && !options.push) {
            console.log('💡 Run: spidersan sync-all --push');
        }

        console.log('');
    });
