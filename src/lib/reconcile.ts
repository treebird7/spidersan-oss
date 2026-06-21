/**
 * Reconcile-on-read (tb-8sa.1 step 2)
 *
 * The registry's `status` field is only as fresh as the last `spidersan merged`
 * / `sync` call — and a committed registry snapshot can carry an `active` entry
 * for a branch that has since merged. Trusting that stale status is what
 * produced the phantom-conflict incident (a fully-merged branch still flagged
 * as conflicting from a stale worktree).
 *
 * Reconcile-on-read folds git truth in BEFORE conflicts / ready-check /
 * merge-order answer:
 *   - ref gone from local AND remote  → orphaned (drop)
 *   - tip is an ancestor of trunk     → merged   (drop)
 *   - otherwise                        → live    (keep)
 *
 * It only consults git for entries the registry still calls `active`; entries
 * already marked `completed` / `abandoned` are honoured without a git probe.
 */

import { resolveBranchRef, isMergedInto } from './git.js';
import { getTrunkBranch } from './trunk.js';
import type { Branch } from '../storage/adapter.js';

export interface ReconcileResult {
    /** Branches still genuinely in flight — the set readers should act on. */
    live: Branch[];
    /** Names detected as merged into trunk (by status or by is-ancestor). */
    merged: string[];
    /** Names whose ref is gone from both local and remote. */
    orphaned: string[];
}

/**
 * Injectable git probes so reconcile is unit-testable without a real repo.
 * Defaults wire to the real `git.ts` helpers via {@link defaultReconcileDeps}.
 */
export interface ReconcileDeps {
    /** Resolve a branch name to a usable ref, or `null` if no ref exists. */
    resolveRef: (name: string) => string | null;
    /** True if `ref` is fully merged into `trunkRef`. */
    isMerged: (ref: string, trunkRef: string) => boolean;
    /** Bare trunk branch name (e.g. `main`) — never reconciled away. */
    trunkName: string;
    /** Ref used as the merge target for is-ancestor (prefers `origin/main`). */
    trunkRef: string;
}

export function defaultReconcileDeps(): ReconcileDeps {
    const trunkName = getTrunkBranch();
    // Prefer the remote trunk ref so a stale local `main` can't mask merges.
    const trunkRef = resolveBranchRef(trunkName) ?? trunkName;
    return {
        resolveRef: (name) => resolveBranchRef(name),
        isMerged: (ref, trunk) => isMergedInto(ref, trunk),
        trunkName,
        trunkRef,
    };
}

/**
 * Partition registered branches into live / merged / orphaned using git truth.
 *
 * @param branches  the raw registry entries (e.g. `await storage.list()`)
 * @param deps      git probes; defaults to the real repo
 */
export function reconcileBranches(
    branches: Branch[],
    deps: ReconcileDeps = defaultReconcileDeps(),
): ReconcileResult {
    const live: Branch[] = [];
    const merged: string[] = [];
    const orphaned: string[] = [];

    for (const branch of branches) {
        // The trunk itself is never "in flight" but also never reconciled away —
        // pass it through unchanged so readers keep their existing handling.
        if (branch.name === deps.trunkName) {
            live.push(branch);
            continue;
        }

        // Honour terminal registry status without a git probe.
        if (branch.status === 'completed') {
            merged.push(branch.name);
            continue;
        }
        if (branch.status === 'abandoned') {
            orphaned.push(branch.name);
            continue;
        }

        // status === 'active' — fold in git truth.
        const ref = deps.resolveRef(branch.name);
        if (ref === null) {
            orphaned.push(branch.name);
            continue;
        }
        if (deps.isMerged(ref, deps.trunkRef)) {
            merged.push(branch.name);
            continue;
        }
        live.push(branch);
    }

    return { live, merged, orphaned };
}

/**
 * Read-path convenience for conflict detection: registered `active` branches
 * minus those PROVEN merged into trunk (is-ancestor true, or status
 * `completed`).
 *
 * Deliberately KEEPS orphaned (no-ref) branches. A missing ref can mean
 * "merged + deleted" but equally "active on another machine, not fetched
 * here" — dropping it would silently miss a real cross-machine conflict.
 * A false phantom from a truly-deleted branch is the safer error, and
 * `spidersan sync` is the intentional op that prunes those.
 *
 * This is what conflicts / ready-check / merge-order should call; `sync`
 * uses {@link reconcileBranches} directly to prune orphans too.
 */
export function activeBranches(branches: Branch[], deps?: ReconcileDeps): Branch[] {
    const { merged } = reconcileBranches(branches, deps);
    const mergedSet = new Set(merged);
    return branches.filter(b => b.status === 'active' && !mergedSet.has(b.name));
}
