import { getMergeConflicts } from './git.js';
import type { MergeConflictKind } from './git.js';

/**
 * Real merge-conflict analysis (git merge-tree backed).
 *
 * Thin orchestration over {@link getMergeConflicts}. Pure function of git state —
 * no registry, no network. NEVER throws for "branch conflicts": a true conflict is
 * a successful RESULT (`clean: false`); only environmental failures (missing ref,
 * not a repository, unsupported tooling) populate `error`.
 *
 * Consumed by the `conflicts --real` command (B1) and `merge-plan`.
 *
 * @module git-merge-analyzer
 */

export type { MergeConflictKind } from './git.js';

export interface RealConflict {
    file: string;
    kind: MergeConflictKind;
}

export interface RealConflictReport {
    base: string;
    branch: string;
    mergeBase: string | null;
    conflicts: RealConflict[]; // empty = clean
    clean: boolean;
    method: 'write-tree' | 'legacy';
    error?: string; // e.g. ref not found / not a repo
}

/**
 * Compute true merge conflicts merging `branch` into `base`.
 *
 * @param base   Trunk / target ref to merge into (local branch, `origin/<ref>`, or SHA).
 * @param branch Feature ref being merged (local branch, `origin/<ref>`, or SHA).
 * @returns A {@link RealConflictReport}. Never rejects for "they conflict"; resolves
 *          with `clean: false` and the conflict list. Environmental failures resolve
 *          with `error` set and `clean: false`.
 */
export async function analyzeRealConflicts(base: string, branch: string): Promise<RealConflictReport> {
    const result = getMergeConflicts(base, branch);

    return {
        base: result.base,
        branch: result.branch,
        mergeBase: result.mergeBase,
        conflicts: result.conflicts.map(({ file, kind }) => ({ file, kind })),
        clean: result.error ? false : result.conflicts.length === 0,
        method: result.method,
        error: result.error,
    };
}
