/**
 * Multi-repo git state scanner for Smart Sync Advisor (F4)
 *
 * Scans all repos under a base directory and identifies:
 * - Unpushed commits (ahead of remote)
 * - Unpulled commits (behind remote)
 * - Dirty state (uncommitted files)
 * - Diverged branches (ahead AND behind)
 *
 * Uses execFileSync with { cwd: repoPath } — no process.chdir()
 */

import { execFileSync } from 'child_process';
import { readdirSync, existsSync } from 'fs';
import { basename, join } from 'path';
import type { SyncRecommendation } from '../types/cloud.js';

export interface RepoState {
    name: string;
    path: string;
    branch: string;
    unpushed: number;
    unpulled: number;
    isDirty: boolean;
    isDiverged: boolean;
    hasUpstream: boolean;
}

/**
 * Scan a single repository for git state.
 * Returns null if not a git repo or unreadable.
 */
export function scanRepo(repoPath: string): RepoState | null {
    try {
        if (!existsSync(join(repoPath, '.git'))) return null;

        let branch = '';
        try {
            branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: repoPath, encoding: 'utf-8',
            }).trim();
        } catch {
            return null;
        }

        let hasUpstream = false;
        let unpushed = 0;
        let unpulled = 0;

        try {
            execFileSync('git', ['rev-parse', '--abbrev-ref', '@{u}'], {
                cwd: repoPath, encoding: 'utf-8',
            });
            hasUpstream = true;

            try {
                unpushed = parseInt(execFileSync('git', ['rev-list', '--count', 'HEAD..@{u}'], {
                    cwd: repoPath, encoding: 'utf-8',
                }).trim(), 10) || 0;
            } catch { /* no commits to push */ }

            try {
                unpulled = parseInt(execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], {
                    cwd: repoPath, encoding: 'utf-8',
                }).trim(), 10) || 0;
            } catch { /* no commits to pull */ }
        } catch {
            hasUpstream = false;
        }

        let isDirty = false;
        try {
            isDirty = execFileSync('git', ['status', '--porcelain'], {
                cwd: repoPath, encoding: 'utf-8',
            }).trim().length > 0;
        } catch { /* error checking status */ }

        return {
            name: basename(repoPath),
            path: repoPath,
            branch,
            unpushed,
            unpulled,
            isDirty,
            isDiverged: unpushed > 0 && unpulled > 0,
            hasUpstream,
        };
    } catch {
        return null;
    }
}

function findRepos(basePath: string, maxDepth = 2, currentDepth = 0): string[] {
    const repos: string[] = [];
    if (currentDepth >= maxDepth) return repos;

    try {
        const entries = readdirSync(basePath, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.name.startsWith('.') && entry.name !== '.git') continue;
            if (['node_modules', 'dist', 'build', '.cache', '.next'].includes(entry.name)) continue;

            const fullPath = join(basePath, entry.name);
            if (entry.isDirectory()) {
                if (existsSync(join(fullPath, '.git'))) {
                    repos.push(fullPath);
                } else {
                    repos.push(...findRepos(fullPath, maxDepth, currentDepth + 1));
                }
            }
        }
    } catch { /* permission denied or other errors */ }

    return repos;
}

/**
 * Scan all repos under a base directory.
 */
export function scanAllRepos(basePath: string): RepoState[] {
    const repos = findRepos(basePath);
    return repos.map(scanRepo).filter((s): s is RepoState => s !== null);
}

/**
 * Convert RepoState[] to SyncRecommendation[].
 */
export function generateRecommendations(states: RepoState[]): SyncRecommendation[] {
    return states.map((state): SyncRecommendation => {
        let action: SyncRecommendation['action'] = 'up-to-date';
        let priority: SyncRecommendation['priority'] = 'low';
        let reason = 'Repository is in sync';

        if (!state.hasUpstream) {
            action = 'conflict';
            priority = 'medium';
            reason = 'No upstream tracking branch configured';
        } else if (state.isDiverged) {
            action = 'rebase';
            priority = 'high';
            reason = `${state.unpushed} commits ahead, ${state.unpulled} commits behind (diverged)`;
        } else if (state.unpushed > 0) {
            action = 'push';
            priority = 'high';
            reason = `${state.unpushed} commit${state.unpushed === 1 ? '' : 's'} ahead of remote`;
        } else if (state.unpulled > 0) {
            action = 'pull';
            priority = 'high';
            reason = `${state.unpulled} commit${state.unpulled === 1 ? '' : 's'} behind remote`;
        } else if (state.isDirty) {
            action = 'conflict';
            priority = 'medium';
            reason = 'Uncommitted changes detected';
        }

        return {
            repo_name: state.name,
            branch_name: state.branch,
            machine_name: '',
            action,
            reason,
            priority,
        };
    }).sort((a, b) => {
        const pOrder = { high: 0, medium: 1, low: 2 };
        const aOrder: Record<string, number> = { push: 0, pull: 1, rebase: 2, conflict: 3, 'up-to-date': 4 };
        if (pOrder[a.priority] !== pOrder[b.priority]) return pOrder[a.priority] - pOrder[b.priority];
        return (aOrder[a.action] ?? 5) - (aOrder[b.action] ?? 5);
    });
}
