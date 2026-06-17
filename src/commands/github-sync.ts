/**
 * spidersan github-sync
 *
 * Fetch branch/PR/CI status from GitHub for configured repos.
 * Part of F2: GitHub Branch Inventory.
 */

import { Command } from 'commander';
import { loadConfig } from '../lib/config.js';
import { SupabaseStorage } from '../storage/supabase.js';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import {
    isGhAvailable,
    listBranches,
    listPullRequests,
    getCIStatus,
    getCommitInfo,
    getAheadBehind,
    type GitHubRepoConfig,
    type GitHubBranchInfo,
    type GitHubPRInfo,
    type AheadBehind,
} from '../lib/github.js';
import type { MachineIdentity } from '../types/cloud.js';

interface GitHubBranchRow {
    id: string;
    repo_owner: string;
    repo_name: string;
    branch_name: string;
    author: string;
    last_commit_sha: string;
    last_commit_date: string;
    /** null = comparison could not be determined (NOT the same as in-sync {0,0}). */
    ahead_behind: AheadBehind | null;
    pr_number: number | null;
    pr_status: string | null;
    is_default: boolean;
    scanned_at: string;
    scanned_by_machine: string;
}

async function loadMachineIdentity(): Promise<MachineIdentity> {
    const configPath = join(homedir(), '.envoak', 'machine.json');
    if (existsSync(configPath)) {
        const raw = await readFile(configPath, 'utf-8');
        const data = JSON.parse(raw);
        return {
            id: data.id || data.machine_id,
            name: data.name || data.machine_name || 'unknown',
            hostname: data.hostname || 'unknown',
        };
    }
    const hostname = execFileSync('hostname', [], { encoding: 'utf-8' }).trim();
    return { id: `fallback-${hostname}`, name: hostname, hostname };
}

async function loadReposConfig(): Promise<{ repos: { owner: string; name: string }[] } | null> {
    const configPath = join(process.cwd(), '.spidersan', 'repos.json');
    if (!existsSync(configPath)) return null;
    try {
        return JSON.parse(await readFile(configPath, 'utf-8'));
    } catch {
        return null;
    }
}

async function getCurrentRepo(): Promise<GitHubRepoConfig | null> {
    try {
        const remote = execFileSync('git', ['config', 'remote.origin.url'], { encoding: 'utf-8' }).trim();
        const sshMatch = remote.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
        if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
        const httpsMatch = remote.match(/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
        if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
        return null;
    } catch {
        return null;
    }
}

interface ScanOptions {
    includeCi: boolean;
    staleDays: number;
    machine: MachineIdentity;
    /** Max branches scanned in parallel. Bounded to stay under gh's rate limits. */
    concurrency?: number;
}

/** Default in-flight branch count — small enough to avoid gh secondary rate limits. */
const DEFAULT_SCAN_CONCURRENCY = 6;

const TRUNK_BRANCHES = new Set(['main', 'master', 'develop', 'production']);

/**
 * Scan a single branch into a row, or null when it has no commit (e.g. just
 * deleted) and should be skipped. Each call makes 1-3 independent gh calls;
 * scanRepository runs these under a bounded pool.
 */
export async function scanBranch(
    config: GitHubRepoConfig,
    branch: GitHubBranchInfo,
    prs: GitHubPRInfo[],
    options: ScanOptions,
): Promise<GitHubBranchRow | null> {
    const commit = await getCommitInfo(config, branch.name);
    if (!commit) return null;

    const pr = prs.find(p => p.headBranch === branch.name);
    // CI status is fetched when requested but not yet persisted (Supabase table
    // pending). Kept for behaviour parity with the previous serial scan.
    if (options.includeCi) void (await getCIStatus(config, branch.name));

    const row: GitHubBranchRow = {
        id: '',
        repo_owner: config.owner,
        repo_name: config.repo,
        branch_name: branch.name,
        author: commit.author,
        last_commit_sha: commit.sha,
        last_commit_date: commit.date,
        ahead_behind: null,
        pr_number: pr?.number || null,
        pr_status: pr?.state || null,
        is_default: false,
        scanned_at: new Date().toISOString(),
        scanned_by_machine: options.machine.id,
    };

    const aheadBehind = await getAheadBehind(config, branch.name);
    if (aheadBehind) {
        row.ahead_behind = aheadBehind;
    } else {
        // Comparison failed (rate-limit / auth / network). Leave it null rather
        // than recording {0,0}, which would mislabel a diverged branch as in-sync.
        console.warn(`  ⚠️  ${branch.name}: could not determine ahead/behind (left as unknown)`);
    }

    return row;
}

export async function scanRepository(
    config: GitHubRepoConfig,
    options: ScanOptions,
): Promise<GitHubBranchRow[]> {
    console.log(`  📡 Scanning ${config.owner}/${config.repo}...`);
    const branches = await listBranches(config);
    const prs = await listPullRequests(config);

    const targets = branches.filter(b => !TRUNK_BRANCHES.has(b.name));
    if (targets.length === 0) return [];

    // Per-branch gh calls are independent, so scan with a bounded worker pool
    // (mirrors gatherFacts in merge-plan.ts). Bounded, NOT unbounded: a burst of
    // parallel `gh` spawns trips GitHub's secondary rate limits. Order is
    // preserved by writing each result into its input slot.
    const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_SCAN_CONCURRENCY, targets.length));
    const slots: (GitHubBranchRow | null)[] = new Array(targets.length).fill(null);
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < targets.length) {
            const i = cursor++;
            slots[i] = await scanBranch(config, targets[i]!, prs, options);
        }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return slots.filter((r): r is GitHubBranchRow => r !== null);
}

async function storeResults(_results: GitHubBranchRow[], _supabase: SupabaseStorage): Promise<number> {
    try {
        console.warn(`  ⚠️  Supabase storage does not support GitHub branch sync yet`);
        return 0;
    } catch (error) {
        console.warn(`  ⚠️  Could not write to Supabase: ${error instanceof Error ? error.message : String(error)}`);
        return 0;
    }
}

export const githubSyncCommand = new Command('github-sync')
    .description('Fetch branch/PR/CI status from GitHub for configured repos')
    .option('--repo <owner/repo>', 'Sync specific repo (auto-detects from git remote if not provided)')
    .option('--all', 'Sync all repos from .spidersan/repos.json')
    .option('--ci', 'Include CI/Actions status (slower)')
    .option('--json', 'Output as JSON')
    .option('--stale-days <n>', 'Mark branches older than N days as stale', '7')
    .option('--concurrency <n>', 'Max branches scanned in parallel (lower if rate-limited)', String(DEFAULT_SCAN_CONCURRENCY))
    .action(async (options) => {
        if (!isGhAvailable()) {
            console.error('❌ GitHub CLI (gh) not found or not authenticated.');
            console.error('   Install: https://cli.github.com  →  gh auth login');
            process.exit(1);
        }

        const machine = await loadMachineIdentity();
        const config = await loadConfig();
        const url = process.env.SUPABASE_URL || config.storage.supabaseUrl;
        const key = process.env.SUPABASE_KEY || config.storage.supabaseKey;
        const supabase = url && key ? new SupabaseStorage({ url, key }) : null;

        let reposToScan: GitHubRepoConfig[] = [];

        if (options.all) {
            const reposConfig = await loadReposConfig();
            if (!reposConfig) {
                console.error('❌ No .spidersan/repos.json found.');
                process.exit(1);
            }
            reposToScan = reposConfig.repos.map(r => ({ owner: r.owner, repo: r.name }));
        } else if (options.repo) {
            const [owner, repo] = options.repo.split('/');
            reposToScan = [{ owner, repo }];
        } else {
            const current = await getCurrentRepo();
            if (!current) {
                console.error('❌ Could not detect current repo. Use --repo owner/repo');
                process.exit(1);
            }
            reposToScan = [current];
        }

        console.log(`🕷️ GitHub sync: scanning ${reposToScan.length} repo(s)\n`);

        const allResults: GitHubBranchRow[] = [];
        let storedCount = 0;

        for (const repo of reposToScan) {
            try {
                const parsedConcurrency = parseInt(options.concurrency, 10);
                const results = await scanRepository(repo, {
                    includeCi: options.ci,
                    staleDays: parseInt(options.staleDays, 10),
                    machine,
                    concurrency: Number.isFinite(parsedConcurrency) ? parsedConcurrency : undefined,
                });
                console.log(`  ✅ Found ${results.length} branches`);
                allResults.push(...results);
                if (supabase && results.length > 0) {
                    storedCount += await storeResults(results, supabase);
                }
            } catch (error) {
                console.error(`  ❌ ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (options.json) {
            console.log(JSON.stringify(allResults, null, 2));
        } else {
            console.log(`\n  📊 Total branches: ${allResults.length}`);
            if (supabase && storedCount > 0) {
                console.log(`  💾 Stored in Supabase: ${storedCount}`);
            } else if (!supabase) {
                console.log(`  ℹ️  Supabase not configured or table missing (results shown above only)`);
            }
        }
    });
