/**
 * spidersan fleet-status
 *
 * Show git sync status (ahead/behind origin) for every repo in ~/Dev.
 * Runs `git fetch` then compares HEAD to origin/<branch>.
 *
 * Output columns: repo | branch | sha | status
 * Flags: --no-fetch (skip fetch, use cached remote refs)
 *        --json     (machine-readable output)
 *        --dir      (scan a different root directory, default ~/Dev)
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

interface RepoStatus {
    repo: string;
    branch: string;
    sha: string;
    ahead: number;
    behind: number;
    status: 'synced' | 'ahead' | 'behind' | 'diverged' | 'detached' | 'no-remote';
}

function run(cmd: string, args: string[], cwd: string): string {
    try {
        return execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
        return '';
    }
}

function checkRepo(dir: string): RepoStatus | null {
    const repo = dir.split('/').pop() ?? dir;

    const branch = run('git', ['branch', '--show-current'], dir);
    if (!branch) return { repo, branch: '(detached)', sha: run('git', ['rev-parse', '--short', 'HEAD'], dir), ahead: 0, behind: 0, status: 'detached' };

    const sha = run('git', ['rev-parse', '--short', 'HEAD'], dir);

    const remoteRef = `origin/${branch}`;
    const hasRemote = run('git', ['rev-parse', '--verify', remoteRef], dir);
    if (!hasRemote) return { repo, branch, sha, ahead: 0, behind: 0, status: 'no-remote' };

    const ahead  = parseInt(run('git', ['rev-list', `${remoteRef}..HEAD`, '--count'], dir) || '0', 10);
    const behind = parseInt(run('git', ['rev-list', `HEAD..${remoteRef}`, '--count'], dir) || '0', 10);

    let status: RepoStatus['status'];
    if      (ahead === 0 && behind === 0) status = 'synced';
    else if (ahead >  0 && behind === 0) status = 'ahead';
    else if (ahead === 0 && behind >  0) status = 'behind';
    else                                  status = 'diverged';

    return { repo, branch, sha, ahead, behind, status };
}

function statusIcon(s: RepoStatus): string {
    switch (s.status) {
        case 'synced':   return '✅';
        case 'ahead':    return `⬆️  AHEAD ${s.ahead}`;
        case 'behind':   return `⬇️  BEHIND ${s.behind}`;
        case 'diverged': return `↕️  DIVERGED (+${s.ahead}/-${s.behind})`;
        case 'detached': return '🔀 DETACHED HEAD';
        case 'no-remote':return '🔌 NO REMOTE';
    }
}

export const fleetStatusCommand = new Command('fleet-status')
    .description('Show git sync status for every repo in ~/Dev')
    .option('--no-fetch', 'Skip git fetch (use cached remote refs)')
    .option('--json',     'Output as JSON')
    .option('--dir <path>', 'Root directory to scan', join(homedir(), 'Dev'))
    .option('--filter <status>', 'Show only: synced|ahead|behind|diverged|all', 'all')
    .action((opts) => {
        const root = opts.dir as string;

        if (!existsSync(root)) {
            console.error(`Directory not found: ${root}`);
            process.exit(1);
        }

        const entries = readdirSync(root, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => join(root, e.name))
            .filter(d => existsSync(join(d, '.git')));

        if (entries.length === 0) {
            console.log('No git repos found in', root);
            return;
        }

        // Fetch all in parallel-ish (fire-and-forget, then collect)
        if (opts.fetch !== false) {
            process.stdout.write(`Fetching ${entries.length} repos…`);
            for (const dir of entries) {
                run('git', ['fetch', '--quiet'], dir);
            }
            process.stdout.write(' done\n');
        }

        const results: RepoStatus[] = entries
            .map(d => checkRepo(d))
            .filter((r): r is RepoStatus => r !== null);

        const filter = opts.filter as string;
        const filtered = filter === 'all' ? results : results.filter(r => r.status === filter);

        if (opts.json) {
            console.log(JSON.stringify(filtered, null, 2));
            return;
        }

        // Pretty table
        const repoWidth   = Math.max(20, ...filtered.map(r => r.repo.length));
        const branchWidth = Math.max(8,  ...filtered.map(r => r.branch.length));

        for (const r of filtered) {
            const icon = statusIcon(r);
            console.log(
                r.repo.padEnd(repoWidth + 2) +
                r.branch.padEnd(branchWidth + 2) +
                r.sha.padEnd(9) +
                icon
            );
        }

        // Summary line
        const counts = { synced: 0, ahead: 0, behind: 0, diverged: 0, other: 0 };
        for (const r of results) {
            if (r.status === 'synced') counts.synced++;
            else if (r.status === 'ahead') counts.ahead++;
            else if (r.status === 'behind') counts.behind++;
            else if (r.status === 'diverged') counts.diverged++;
            else counts.other++;
        }

        console.log('');
        console.log(
            `${results.length} repos — ` +
            `✅ ${counts.synced} synced` +
            (counts.ahead    ? `  ⬆️  ${counts.ahead} ahead`    : '') +
            (counts.behind   ? `  ⬇️  ${counts.behind} behind`   : '') +
            (counts.diverged ? `  ↕️  ${counts.diverged} diverged` : '') +
            (counts.other    ? `  🔌 ${counts.other} no-remote`  : '')
        );
    });
