/**
 * remote-drift.ts
 *
 * Detects whether origin/main has advanced past local HEAD and cross-references
 * the drift zone against (a) the registered file list and (b) unstaged tracked
 * files in the working tree.
 *
 * Core primitives (getDriftZone, getUnstagedTrackedFiles, classifyDriftZone)
 * are exported so that watch --fetch-poll can reuse them without importing
 * from the command layer.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getCurrentBranch, getAheadBehind } from './git.js';
import { classifyTier } from './conflict-tier.js';
import { validateBranchName } from './security.js';

export interface DriftEntry {
    file: string;
    registered: boolean;
    tier: 1 | 2 | 3 | null; // null = not registered
    unstaged: boolean;       // true = git rebase --continue blocker risk
}

export interface DriftResult {
    branch: string;
    remote: string;
    localAhead: number;
    remoteAhead: number;
    state: 'synced' | 'local_ahead' | 'remote_ahead' | 'diverged';
    driftZone: string[];
    registeredInDrift: DriftEntry[];
    unstagedInDrift: DriftEntry[];
    safeToPush: boolean;
    rebaseContinueRisk: boolean;
    recommendation: 'synced' | 'push_clean' | 'pull_rebase' | 'rebase_clean' | 'rebase_with_conflict_prep';
}

export interface DriftSkipped {
    skipped: true;
    reason: string;
}

function execGit(args: string[]): string {
    return execFileSync('git', args, {
        encoding: 'utf-8',
        env: { ...process.env },
    });
}

function isOfflineError(error: unknown): boolean {
    const msg = String(error instanceof Error ? error.message : error);
    return /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|network|Could not resolve host|unable to connect|cannot access/i.test(msg);
}

function isInRebase(): boolean {
    try {
        const gitDir = execGit(['rev-parse', '--git-dir']).trim();
        return (
            fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
            fs.existsSync(path.join(gitDir, 'rebase-apply'))
        );
    } catch {
        return false;
    }
}

/**
 * Returns the union of files touched by commits that origin/<branch> has but
 * local HEAD does not. Requires a prior `git fetch origin`.
 */
export function getDriftZone(remote: string, branch: string): string[] {
    const safeBranch = validateBranchName(branch);
    const upstreamRef = `${remote}/${safeBranch}`;

    let commitList: string;
    try {
        commitList = execGit(['rev-list', `HEAD..${upstreamRef}`]).trim();
    } catch {
        return [];
    }

    if (!commitList) return [];

    const shas = commitList.split('\n').filter(Boolean);
    const files = new Set<string>();

    for (const sha of shas) {
        try {
            const stat = execGit(['show', '--stat', '--format=', sha]);
            for (const line of stat.split('\n')) {
                // Lines like: " src/lib/git.ts | 10 ++--"
                const match = /^\s+(.+?)\s+\|/.exec(line);
                if (match && match[1]) {
                    files.add(match[1].trim());
                }
            }
        } catch {
            // skip unparseable commit
        }
    }

    return [...files];
}

/**
 * Returns tracked files that have unstaged modifications (working tree vs index).
 */
export function getUnstagedTrackedFiles(): string[] {
    try {
        const output = execGit(['diff', '--name-only']).trim();
        return output ? output.split('\n').filter(Boolean) : [];
    } catch {
        return [];
    }
}

/**
 * Cross-references driftFiles against registeredFiles + unstagedFiles.
 * Returns a DriftEntry for each file in the drift zone.
 */
export function classifyDriftZone(
    driftFiles: string[],
    registeredFiles: string[],
    unstagedFiles: string[],
    tierOptions?: { extraTier3?: RegExp[]; extraTier2?: RegExp[] },
): DriftEntry[] {
    const registeredSet = new Set(registeredFiles);
    const unstagedSet = new Set(unstagedFiles);

    return driftFiles.map((file): DriftEntry => {
        const registered = registeredSet.has(file);
        const unstaged = unstagedSet.has(file);
        const tier = registered
            ? classifyTier(file, {
                extraTier3: tierOptions?.extraTier3 ?? [],
                extraTier2: tierOptions?.extraTier2 ?? [],
            })
            : null;

        return { file, registered, tier, unstaged };
    });
}

function deriveState(localAhead: number, remoteAhead: number): DriftResult['state'] {
    if (localAhead === 0 && remoteAhead === 0) return 'synced';
    if (localAhead > 0 && remoteAhead === 0) return 'local_ahead';
    if (localAhead === 0 && remoteAhead > 0) return 'remote_ahead';
    return 'diverged';
}

function deriveRecommendation(
    state: DriftResult['state'],
    registeredInDrift: DriftEntry[],
    unstagedInDrift: DriftEntry[],
): DriftResult['recommendation'] {
    if (state === 'synced') return 'synced';
    if (state === 'local_ahead') return 'push_clean';
    // remote_ahead or diverged
    if (registeredInDrift.length > 0 || unstagedInDrift.length > 0) {
        return 'rebase_with_conflict_prep';
    }
    return state === 'diverged' ? 'rebase_clean' : 'pull_rebase';
}

/**
 * Main entry point. Fetches origin, computes drift, classifies against registry
 * and working tree. Returns DriftSkipped for graceful-degradation cases.
 */
export async function computeDriftResult(
    registeredFiles: string[],
    options?: { remote?: string; branch?: string },
): Promise<DriftResult | DriftSkipped> {
    const remote = options?.remote ?? 'origin';

    // Detect mid-rebase
    if (isInRebase()) {
        return { skipped: true, reason: 'Rebase in progress — run after completing or aborting rebase' };
    }

    // Determine branch
    let branch: string;
    try {
        branch = options?.branch ?? getCurrentBranch();
    } catch {
        return { skipped: true, reason: 'Not in a git repository' };
    }

    if (branch === 'HEAD') {
        return { skipped: true, reason: 'Detached HEAD — cannot determine branch' };
    }

    // Fetch
    try {
        execGit(['fetch', remote]);
    } catch (error) {
        if (isOfflineError(error)) {
            return { skipped: true, reason: '⚠ Remote unreachable — drift check skipped' };
        }
        const msg = error instanceof Error ? error.message : String(error);
        if (/No such remote|remote .* not found/i.test(msg)) {
            return { skipped: true, reason: `No remote '${remote}' found` };
        }
        // Unknown fetch error — still skip gracefully
        return { skipped: true, reason: `Fetch failed: ${msg}` };
    }

    // Check if remote branch exists
    const safeBranch = validateBranchName(branch);
    const upstreamRef = `${remote}/${safeBranch}`;
    try {
        execGit(['rev-parse', '--verify', upstreamRef]);
    } catch {
        // Remote branch doesn't exist yet (first push)
        return {
            branch,
            remote: upstreamRef,
            localAhead: 0,
            remoteAhead: 0,
            state: 'synced',
            driftZone: [],
            registeredInDrift: [],
            unstagedInDrift: [],
            safeToPush: true,
            rebaseContinueRisk: false,
            recommendation: 'push_clean',
        };
    }

    // Ahead/behind
    let localAhead: number;
    let remoteAhead: number;
    try {
        const ab = getAheadBehind(remote, branch);
        localAhead = ab.ahead;
        remoteAhead = ab.behind; // getAheadBehind returns { ahead: local, behind: remote }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/not a git repository/i.test(msg)) {
            return { skipped: true, reason: 'Not in a git repository' };
        }
        return { skipped: true, reason: `Could not compute ahead/behind: ${msg}` };
    }

    const state = deriveState(localAhead, remoteAhead);

    // Only compute drift zone when remote has new commits
    let driftZone: string[] = [];
    let entries: DriftEntry[] = [];

    if (remoteAhead > 0) {
        driftZone = getDriftZone(remote, branch);
        const unstagedFiles = getUnstagedTrackedFiles();
        entries = classifyDriftZone(driftZone, registeredFiles, unstagedFiles);
    }

    const registeredInDrift = entries.filter(e => e.registered);
    const unstagedInDrift = entries.filter(e => e.unstaged);
    const rebaseContinueRisk = unstagedInDrift.length > 0;
    const safeToPush = remoteAhead === 0;
    const recommendation = deriveRecommendation(state, registeredInDrift, unstagedInDrift);

    return {
        branch,
        remote: upstreamRef,
        localAhead,
        remoteAhead,
        state,
        driftZone,
        registeredInDrift,
        unstagedInDrift,
        safeToPush,
        rebaseContinueRisk,
        recommendation,
    };
}
