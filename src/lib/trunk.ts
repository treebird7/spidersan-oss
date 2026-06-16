/**
 * Trunk branch detection.
 *
 * Centralizes the "which branch is trunk?" question that was previously
 * hardcoded as `main`/`master` in several places.
 *
 * Resolution order (first hit wins):
 *   1. `git symbolic-ref refs/remotes/origin/HEAD` (strip the `origin/` prefix)
 *   2. `.spidersanrc` `trunk` key
 *   3. `main`   — if that branch exists
 *   4. `master` — if that branch exists
 *   5. `'main'` — default fallback
 *
 * Pure + cached per `cwd` within a process. Tolerates a missing
 * `origin/HEAD` (fresh clones throw — we catch and fall through).
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { execGit } from './git.js';

const CONFIG_FILES = ['.spidersanrc', '.spidersanrc.json', '.spidersan.config.json'];

// Per-cwd cache so repeated calls within a process don't re-shell out to git.
const cache = new Map<string, string>();

function resolveCwd(opts?: { cwd?: string }): string {
    return opts?.cwd ?? process.cwd();
}

/** origin/HEAD symbolic-ref → branch name, or null if unset / fresh clone. */
function fromOriginHead(cwd: string): string | null {
    try {
        const out = execGit(['-C', cwd, 'symbolic-ref', 'refs/remotes/origin/HEAD'], {
            stdio: ['pipe', 'pipe', 'ignore'],
        }).trim();
        // e.g. "refs/remotes/origin/develop" → "develop"
        const prefix = 'refs/remotes/origin/';
        const ref = out.startsWith(prefix) ? out.slice(prefix.length) : out.replace(/^origin\//, '');
        return ref || null;
    } catch {
        // Fresh clones / no origin/HEAD set: throws — fall through.
        return null;
    }
}

/** `.spidersanrc` `trunk` key (project-local), or null if absent/unreadable. */
function fromConfig(cwd: string): string | null {
    for (const filename of CONFIG_FILES) {
        const path = join(cwd, filename);
        if (!existsSync(path)) continue;
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
            const trunk = parsed?.trunk;
            if (typeof trunk === 'string' && trunk.trim()) {
                return trunk.trim();
            }
        } catch {
            // Malformed config — ignore and keep looking.
        }
    }
    return null;
}

/** True if a local branch ref exists. */
function branchExists(cwd: string, branch: string): boolean {
    try {
        execGit(['-C', cwd, 'rev-parse', '--verify', `refs/heads/${branch}`], {
            stdio: ['pipe', 'pipe', 'ignore'],
        });
        return true;
    } catch {
        return false;
    }
}

function resolveTrunk(cwd: string): string {
    const fromHead = fromOriginHead(cwd);
    if (fromHead) return fromHead;

    const fromCfg = fromConfig(cwd);
    if (fromCfg) return fromCfg;

    if (branchExists(cwd, 'main')) return 'main';
    if (branchExists(cwd, 'master')) return 'master';

    return 'main';
}

/**
 * Resolve the repo's trunk branch name.
 *
 * @param opts.cwd - Repo directory (defaults to `process.cwd()`).
 * @returns The trunk branch name (e.g. `'main'`, `'master'`, `'develop'`).
 */
export function getTrunkBranch(opts?: { cwd?: string }): string {
    const cwd = resolveCwd(opts);
    const cached = cache.get(cwd);
    if (cached !== undefined) return cached;

    const trunk = resolveTrunk(cwd);
    cache.set(cwd, trunk);
    return trunk;
}

/**
 * True if `branch` is the repo's trunk.
 *
 * @param branch - Branch name to test.
 * @param opts.cwd - Repo directory (defaults to `process.cwd()`).
 */
export function isTrunk(branch: string, opts?: { cwd?: string }): boolean {
    return branch === getTrunkBranch(opts);
}

/**
 * Clear the per-cwd trunk cache. Intended for tests; harmless in production.
 */
export function _clearTrunkCache(): void {
    cache.clear();
}
