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
 *   - ref gone from local AND remote           → orphaned (drop)
 *   - tip is an ancestor of trunk              → merged   (drop)
 *   - trunk has a patch-id-equivalent squash   → merged   (drop, tb-tr1z)
 *   - otherwise                                 → live    (keep)
 *
 * It only consults git for entries the registry still calls `active`; entries
 * already marked `completed` / `abandoned` are honoured without a git probe.
 */

import { resolveBranchRef, resolveLocalBranchRef, isMergedInto, isSquashMergedInto, listRemoteHeads } from './git.js';
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
    /**
     * Resolve the LOCAL ref (`refs/heads/<name>`), or `null` if none. When the
     * primary ref is the remote-tracking one, a stale `origin/<name>` can be an
     * ancestor of trunk while fresh unpushed local commits are not — both must
     * be merged before the branch is reconciled away. Optional for injectors.
     */
    resolveLocalRef?: (name: string) => string | null;
    /** True if `ref` is fully merged into `trunkRef`. */
    isMerged: (ref: string, trunkRef: string) => boolean;
    /**
     * True if `ref`'s content landed in trunk via a SQUASH merge (tb-tr1z) —
     * consulted only when `isMerged` says no, since squash merges never make
     * the tip an ancestor. Optional for injectors.
     */
    isSquashMerged?: (ref: string, trunkRef: string) => boolean;
    /**
     * Branch names that exist on the remote now, or `null` if it can't be asked.
     * {@link activeBranches} drops an orphan only when this confirms it is gone.
     * Absent (injectors) behaves like `null`: orphans are kept.
     */
    remoteHeads?: () => Set<string> | null;
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
        resolveLocalRef: (name) => resolveLocalBranchRef(name),
        isMerged: (ref, trunk) => isMergedInto(ref, trunk),
        isSquashMerged: (ref, trunk) => isSquashMergedInto(ref, trunk),
        remoteHeads: () => listRemoteHeads(),
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

        // status === 'active' — fold in git truth. Squash merges never make
        // the tip an ancestor, so fall back to patch-id equivalence (tb-tr1z).
        const provenMerged = (r: string) =>
            deps.isMerged(r, deps.trunkRef) || (deps.isSquashMerged?.(r, deps.trunkRef) ?? false);

        const ref = deps.resolveRef(branch.name);
        if (ref === null) {
            orphaned.push(branch.name);
            continue;
        }
        if (provenMerged(ref)) {
            // The primary ref may be a stale origin/<name> while unpushed local
            // commits exist — only reconcile away if the local tip (when it
            // exists and differs) is merged too.
            const localRef = deps.resolveLocalRef?.(branch.name) ?? null;
            if (localRef === null || localRef === ref || provenMerged(localRef)) {
                merged.push(branch.name);
                continue;
            }
        }
        live.push(branch);
    }

    return { live, merged, orphaned };
}

/**
 * Read-path convenience for conflict detection: registered `active` branches
 * minus those PROVEN merged into trunk (is-ancestor / squash-equivalent, or
 * status `completed`) and those PROVEN deleted.
 *
 * An orphan (no local or tracking ref) is ambiguous: deleted, or live on
 * another machine and never fetched here. A squash-merged, deleted branch is
 * never an ancestor of trunk, so it only ever reads as orphaned — keeping every
 * orphan made those phantom-conflict forever. So an orphan is dropped only when
 * `git ls-remote` confirms the branch is gone from the remote; if the remote
 * can't be asked, orphans are kept (a phantom beats a missed conflict). This
 * matters most for ready-check, which gets no cross-machine registry pull.
 *
 * Read-side filter only — nothing is deleted. This is what conflicts /
 * ready-check / merge-order should call; `sync` uses {@link reconcileBranches}
 * directly to actually prune merged and orphaned entries.
 */
export function activeBranches(branches: Branch[], deps: ReconcileDeps = defaultReconcileDeps()): Branch[] {
    const { live, orphaned } = reconcileBranches(branches, deps);
    // Only hit the network when there is an orphan to decide.
    const heads = orphaned.length > 0 ? (deps.remoteHeads?.() ?? null) : null;
    const keep = new Set([...live.map(b => b.name), ...orphaned.filter(n => heads === null || heads.has(n))]);
    return branches.filter(b => b.status === 'active' && keep.has(b.name));
}
