/**
 * spidersan merge-plan
 *
 * Ordered merge plan for open PRs — the fusion command. For each open PR it
 * fuses three independent signals into a single per-PR verdict + a global order:
 *
 *   - PR state (A2):  base branch, mergeStateStatus, mergeable, CI rollup.
 *   - Real conflict (A1): analyzeRealConflicts(base, head) — the TRUE blocker
 *                         file(s), from `git merge-tree`, not registry overlap.
 *   - Staleness:      commits behind base (getAheadBehind) → a STALE flag.
 *   - Stack (A3):     base == another open PR's head ⇒ stacked child; order
 *                     the parent before the child and flag retarget-needed.
 *
 * Reproduces the RT #175→#179→#181 merge train we hand-stitched on 2026-06-16.
 * Exit 0 always — this is a planner/advisor, not a gate.
 *
 * @module commands/merge-plan
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import {
    isGhAvailable,
    listPullRequests,
    getPRMergeState,
    getAheadBehind,
    type GitHubRepoConfig,
    type GitHubPRInfo,
    type PRMergeState,
} from '../lib/github.js';
import { analyzeRealConflicts } from '../lib/git-merge-analyzer.js';
import { getTrunkBranch } from '../lib/trunk.js';
import { topologicalSort } from '../lib/graph.js';

// ───────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────

export interface MergePlanOptions {
    json?: boolean;
    base?: string;
    limit?: string;
    includeDrafts?: boolean;
    repo?: string;
}

export type Verdict =
    | 'MERGE'
    | 'BLOCKED'
    | 'WAIT'
    | 'VERIFY'
    | 'STALE'
    | 'UNKNOWN';

export interface PlanEntry {
    number: number;
    title: string;
    verdict: Verdict;
    /** Short human-readable reason that pairs with the verdict label. */
    reason: string;
    base: string;
    head: string;
    mergeStateStatus: PRMergeState['mergeStateStatus'];
    mergeable: PRMergeState['mergeable'];
    behind: number;
    stale: boolean;
    conflicts: string[];
    stackedOn: number | null;
    advisories: string[];
}

export interface MergePlan {
    base: string;
    generatedFor: string;
    plan: PlanEntry[];
}

/**
 * Per-PR facts gathered from the libs, before ordering/verdict assignment.
 * Exposed so {@link buildMergePlan} stays a pure, unit-testable function of data.
 */
export interface PRFacts {
    number: number;
    title: string;
    base: string;
    head: string;
    headRefOid?: string;
    mergeable: PRMergeState['mergeable'];
    mergeStateStatus: PRMergeState['mergeStateStatus'];
    failingRequired: string[];
    behind: number;
    /** Real merge-tree conflict files (empty = clean). */
    conflictFiles: string[];
    /** Set when conflict analysis itself failed (ref unfetchable, etc.). */
    conflictError?: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Repo resolution
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resolve the target repo as a canonical "owner/name" string.
 *
 * `--repo` wins; otherwise `gh repo view --json owner,name` for the current
 * directory's repo. Returns null if it can't be resolved (caller surfaces a
 * friendly message).
 */
export function resolveRepoSlug(repoOpt?: string): string | null {
    if (repoOpt && repoOpt.trim()) {
        return repoOpt.trim();
    }
    try {
        const out = execFileSync('gh', ['repo', 'view', '--json', 'owner,name'], {
            encoding: 'utf-8',
            stdio: 'pipe',
        });
        const data = JSON.parse(out) as { owner?: { login?: string }; name?: string };
        const owner = data.owner?.login;
        const name = data.name;
        if (owner && name) {
            return `${owner}/${name}`;
        }
    } catch {
        // fall through
    }
    return null;
}

/** Split an "owner/name" slug into the {@link GitHubRepoConfig} the A-libs want. */
function slugToConfig(slug: string): GitHubRepoConfig {
    const idx = slug.indexOf('/');
    if (idx < 0) {
        // Best-effort: treat the whole thing as repo with empty owner.
        return { owner: '', repo: slug };
    }
    return { owner: slug.slice(0, idx), repo: slug.slice(idx + 1) };
}

// ───────────────────────────────────────────────────────────────────────────
// Fork-safe head fetch
// ───────────────────────────────────────────────────────────────────────────

/**
 * Make a PR's head commit available locally so `git merge-tree` can read it.
 *
 * Fork heads aren't under `origin/<branch>`, and `headRefName` may not exist
 * locally — `pull/<n>/head` is the canonical, always-present ref. We fetch it
 * (best-effort) and return the SHA to merge against. Prefers `headRefOid` (the
 * exact PR head); falls back to FETCH_HEAD.
 *
 * @returns the head ref/SHA to pass to analyzeRealConflicts, or null on failure.
 */
export function fetchPRHead(prNumber: number, headRefOid?: string): string | null {
    try {
        execFileSync('git', ['fetch', 'origin', `pull/${prNumber}/head`], {
            encoding: 'utf-8',
            stdio: 'pipe',
        });
    } catch {
        // The fetch may fail on forks of forks / detached setups. If we have the
        // SHA we can still try to use it (it may already be reachable); else bail.
        if (!headRefOid) return null;
    }
    if (headRefOid) return headRefOid;
    return 'FETCH_HEAD';
}

// ───────────────────────────────────────────────────────────────────────────
// Fact gathering (impure: shells out via the A-libs)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Gather all per-PR facts for the plan. Bounded concurrency keeps gh happy.
 *
 * @param openPRs       Filtered, draft-resolved open PR list.
 * @param trunk         The resolved trunk branch.
 * @param repoSlug      "owner/name" for gh calls.
 * @param concurrency   Max in-flight PRs (default 4).
 */
export async function gatherFacts(
    openPRs: GitHubPRInfo[],
    trunk: string,
    repoSlug: string,
    concurrency = 4,
): Promise<PRFacts[]> {
    const config = slugToConfig(repoSlug);
    const results: PRFacts[] = [];
    let cursor = 0;

    async function worker(): Promise<void> {
        while (cursor < openPRs.length) {
            const pr = openPRs[cursor++];
            results.push(await gatherOne(pr, trunk, repoSlug, config));
        }
    }

    const workers = Array.from(
        { length: Math.max(1, Math.min(concurrency, openPRs.length)) },
        () => worker(),
    );
    await Promise.all(workers);

    // Preserve PR-number order for deterministic downstream behaviour.
    results.sort((a, b) => a.number - b.number);
    return results;
}

async function gatherOne(
    pr: GitHubPRInfo,
    trunk: string,
    repoSlug: string,
    config: GitHubRepoConfig,
): Promise<PRFacts> {
    const state = await getPRMergeState(pr.number, { repo: repoSlug });

    // getPRMergeState can return null (gh gone / PR vanished mid-run). Degrade
    // gracefully to an UNKNOWN-shaped fact rather than crashing the whole plan.
    if (!state) {
        return {
            number: pr.number,
            title: pr.title,
            base: trunk,
            head: pr.headBranch,
            mergeable: 'UNKNOWN',
            mergeStateStatus: 'UNKNOWN',
            failingRequired: [],
            behind: 0,
            conflictFiles: [],
            conflictError: 'merge-state unavailable',
        };
    }

    const base = state.baseRefName || trunk;
    const head = state.headRefName || pr.headBranch;

    // Fork-safe head: fetch pull/<n>/head, prefer the exact headRefOid SHA.
    const headRef = fetchPRHead(pr.number, state.headRefOid);

    let conflictFiles: string[] = [];
    let conflictError: string | undefined;
    if (headRef) {
        try {
            const report = await analyzeRealConflicts(base, headRef);
            if (report.error) {
                conflictError = report.error;
            } else {
                conflictFiles = report.conflicts.map((c) => c.file);
            }
        } catch (err) {
            conflictError = err instanceof Error ? err.message : String(err);
        }
    } else {
        conflictError = 'head ref unfetchable';
    }

    // Staleness: how many commits behind the base. (head vs base ahead/behind.)
    // getAheadBehind returns null when the compare couldn't be determined; treat
    // that as "unknown staleness" (0) — mergeStateStatus=BEHIND is the primary signal.
    const ab = await getAheadBehind(config, head, base);
    const behind = ab?.behind ?? 0;

    return {
        number: pr.number,
        title: pr.title,
        base,
        head,
        headRefOid: state.headRefOid,
        mergeable: state.mergeable,
        mergeStateStatus: state.mergeStateStatus,
        failingRequired: state.checkRollup.failingRequired,
        behind,
        conflictFiles,
        conflictError,
    };
}

// ───────────────────────────────────────────────────────────────────────────
// Plan building (pure — unit-testable)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Readiness rank for the secondary, stable, within-available-set sort: a clean,
 * green, on-trunk PR (lower is better) outranks a behind/conflicted one.
 */
function readinessRank(f: PRFacts, stackedOn: number | null): number {
    if (stackedOn !== null) return 4; // stacked — always after its parent set
    if (f.conflictFiles.length > 0) return 3; // hard blocker
    if (f.mergeable === 'MERGEABLE' && f.failingRequired.length === 0 && f.behind === 0) {
        return 0; // clean + green + current
    }
    return 2; // available but not pristine
}

/**
 * Assign a single PR's verdict + reason + advisories. Stack/staleness already
 * computed by the caller.
 */
function assignVerdict(
    f: PRFacts,
    stackedOn: number | null,
    stale: boolean,
    trunk: string,
): Pick<PlanEntry, 'verdict' | 'reason' | 'advisories'> {
    const advisories: string[] = [];

    if (stale) {
        advisories.push(`${f.behind} commit(s) behind ${f.base}`);
    }

    // 1. Stacked child → WAIT (highest-priority structural reason).
    if (stackedOn !== null) {
        advisories.push(`retarget to ${trunk} after #${stackedOn} lands`);
        return {
            verdict: 'WAIT',
            reason: `stacked on #${stackedOn}`,
            advisories,
        };
    }

    // 2. Real conflict → BLOCKED.
    if (f.conflictFiles.length > 0) {
        return {
            verdict: 'BLOCKED',
            reason: `conflict in ${f.conflictFiles.join(', ')}`,
            advisories,
        };
    }

    // Couldn't analyze conflicts at all — surface, don't pretend clean.
    if (f.conflictError) {
        advisories.push(`conflict check skipped: ${f.conflictError}`);
    }

    // 3. Unresolved mergeability → UNKNOWN (honest).
    if (f.mergeable === 'UNKNOWN') {
        return {
            verdict: 'UNKNOWN',
            reason: 'mergeability not yet computed',
            advisories,
        };
    }

    // 4. Required-check failing / non-clean merge state → VERIFY.
    if (f.failingRequired.length > 0) {
        return {
            verdict: 'VERIFY',
            reason: `required check failing: ${f.failingRequired.join(', ')}`,
            advisories,
        };
    }
    if (f.mergeStateStatus !== 'CLEAN' && f.mergeStateStatus !== 'UNSTABLE') {
        return {
            verdict: 'VERIFY',
            reason: f.mergeStateStatus,
            advisories,
        };
    }

    // 5. Behind base but otherwise fine → STALE (paired verdict).
    if (stale) {
        return {
            verdict: 'STALE',
            reason: `${f.behind} commit(s) behind base`,
            advisories,
        };
    }

    // 6. Clean, green, on trunk → MERGE.
    //    (UNSTABLE = only non-required checks red — still mergeable.)
    return {
        verdict: 'MERGE',
        reason: f.mergeStateStatus === 'UNSTABLE' ? 'mergeable (non-required checks red)' : 'mergeable',
        advisories,
    };
}

/**
 * Build the ordered merge plan from gathered facts. Pure function of `facts` +
 * `trunk` — no I/O — so the golden RT case is asserted without a network.
 *
 * Ordering:
 *   1. Stack edges parent→child fed to {@link topologicalSort} (parents first).
 *   2. Within the topo order, a stable readiness re-sort that NEVER reorders a
 *      parent after its child (rank keeps stacked PRs last; topo already places
 *      each parent before its child).
 */
export function buildMergePlan(facts: PRFacts[], trunk: string, repoSlug: string): MergePlan {
    const openNumbers = new Set(facts.map((f) => f.number));
    const byNumber = new Map(facts.map((f) => [f.number, f] as const));

    // head branch name → PR number (to detect a child whose base is this head).
    const headToNumber = new Map<string, number>();
    for (const f of facts) {
        if (f.head) headToNumber.set(f.head, f.number);
    }

    // stackedOn: this PR's base equals another OPEN PR's head ⇒ that PR is parent.
    const stackedOn = new Map<number, number | null>();
    for (const f of facts) {
        const parent = f.base && f.base !== trunk ? headToNumber.get(f.base) : undefined;
        stackedOn.set(
            f.number,
            parent !== undefined && parent !== f.number && openNumbers.has(parent) ? parent : null,
        );
    }

    // Graph edges parent → child (topologicalSort emits zero-in-degree first).
    const graph = new Map<string, string[]>();
    for (const f of facts) {
        graph.set(String(f.number), []);
    }
    for (const f of facts) {
        const parent = stackedOn.get(f.number);
        if (parent !== null && parent !== undefined) {
            const children = graph.get(String(parent)) ?? [];
            children.push(String(f.number));
            graph.set(String(parent), children);
        }
    }

    const nodes = facts.map((f) => String(f.number));
    const topoOrder = topologicalSort(nodes, graph);

    // Readiness re-sort WITHIN the topo order. We assign each PR an index from
    // the topo order, then do a stable sort whose primary key is readiness and
    // whose tiebreak preserves topo position — guaranteeing a parent (lower
    // topo index, and never rank 4) precedes its stacked child.
    const topoIndex = new Map<string, number>();
    topoOrder.forEach((n, i) => topoIndex.set(n, i));

    const staleOf = (f: PRFacts) => f.mergeStateStatus === 'BEHIND' || f.behind > 0;

    const ordered = [...topoOrder].sort((a, b) => {
        const fa = byNumber.get(Number(a))!;
        const fb = byNumber.get(Number(b))!;
        const ra = readinessRank(fa, stackedOn.get(fa.number) ?? null);
        const rb = readinessRank(fb, stackedOn.get(fb.number) ?? null);
        if (ra !== rb) return ra - rb;
        // Two stacked PRs may be parent↔child in a chained stack (stack-of-stacks).
        // The `behind` tiebreak must NEVER cross a stack edge, or a child can sort
        // ahead of its parent. Order stacked-vs-stacked by topo index ONLY (topo
        // already encodes parent→child). The non-stacked stack edge (parent rank<4,
        // child rank 4) is already separated by the rank check above.
        const aStacked = (stackedOn.get(fa.number) ?? null) !== null;
        const bStacked = (stackedOn.get(fb.number) ?? null) !== null;
        if (aStacked && bStacked) {
            return (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
        }
        // Same readiness tier, not a stacked pair: behind ascending (fresher first).
        if (fa.behind !== fb.behind) return fa.behind - fb.behind;
        // Final tiebreak: preserve topo order.
        return (topoIndex.get(a) ?? 0) - (topoIndex.get(b) ?? 0);
    });

    const plan: PlanEntry[] = ordered.map((n) => {
        const f = byNumber.get(Number(n))!;
        const so = stackedOn.get(f.number) ?? null;
        const stale = staleOf(f);
        const { verdict, reason, advisories } = assignVerdict(f, so, stale, trunk);
        return {
            number: f.number,
            title: f.title,
            verdict,
            reason,
            base: f.base,
            head: f.head,
            mergeStateStatus: f.mergeStateStatus,
            mergeable: f.mergeable,
            behind: f.behind,
            stale,
            conflicts: f.conflictFiles,
            stackedOn: so,
            advisories,
        };
    });

    return { base: trunk, generatedFor: repoSlug, plan };
}

// ───────────────────────────────────────────────────────────────────────────
// Rendering
// ───────────────────────────────────────────────────────────────────────────

const VERDICT_LABEL: Record<Verdict, string> = {
    MERGE: 'MERGE',
    BLOCKED: 'BLOCKED',
    WAIT: 'WAIT (stack)',
    VERIFY: 'VERIFY',
    STALE: 'STALE',
    UNKNOWN: 'UNKNOWN',
};

export function renderHumanPlan(plan: MergePlan): string {
    const lines: string[] = [];
    const count = plan.plan.length;
    lines.push(
        `🕷️ Merge plan — base: ${plan.base} (${count} open PR${count === 1 ? '' : 's'})`,
    );
    lines.push('');

    if (count === 0) {
        lines.push('  No open PRs to plan.');
        return lines.join('\n');
    }

    plan.plan.forEach((entry, i) => {
        const num = `#${entry.number}`.padEnd(5);
        const label = VERDICT_LABEL[entry.verdict].padEnd(16);
        const title = entry.title.length > 28 ? entry.title.slice(0, 27) + '…' : entry.title;
        lines.push(`  ${i + 1}. ${num} ${label} ${title.padEnd(30)} ${entry.reason}`);
        if (entry.advisories.length > 0) {
            for (const adv of entry.advisories) {
                lines.push(`        ↳ ${adv}`);
            }
        }
    });

    lines.push('');
    lines.push('  Legend: MERGE ✓ ready · BLOCKED real conflict · WAIT stacked · VERIFY check/state · STALE behind base');
    lines.push('  Note: CI red can be flake/infra — staleness shown, realness is yours to judge.');
    return lines.join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Command
// ───────────────────────────────────────────────────────────────────────────

export const mergePlanCommand = new Command('merge-plan')
    .description('Ordered merge plan for open PRs (fuses PR + CI + real git conflicts)')
    .option('--json', 'Output as JSON')
    .option('--base <trunk>', 'Trunk branch to plan against (default: auto-detected)')
    .option('--limit <n>', 'Maximum number of open PRs to include')
    .option('--include-drafts', 'Include draft PRs (default: off)')
    .option('--repo <owner/name>', 'Target repo (default: current repo via gh)')
    .action(async (options: MergePlanOptions) => {
        // 1. gh guard.
        if (!isGhAvailable()) {
            console.log('🕷️ GitHub CLI (gh) is not available or not authenticated.');
            console.log('   Install: https://cli.github.com  →  gh auth login');
            return; // exit 0 — advisory
        }

        // 2. Resolve repo slug.
        const repoSlug = resolveRepoSlug(options.repo);
        if (!repoSlug) {
            console.log('🕷️ Could not resolve a GitHub repo.');
            console.log('   Pass --repo owner/name, or run inside a repo with a GitHub remote.');
            return; // exit 0
        }

        const trunk = (options.base && options.base.trim()) || getTrunkBranch();
        const config = slugToConfig(repoSlug);

        // 3. List + filter open, non-draft PRs.
        const all = await listPullRequests(config);
        let openPRs = all.filter((pr) => pr.state === 'OPEN');
        if (!options.includeDrafts) {
            openPRs = openPRs.filter((pr) => !pr.draft);
        }
        // Deterministic input order before limiting.
        openPRs.sort((a, b) => a.number - b.number);

        if (options.limit) {
            const lim = parseInt(options.limit, 10);
            if (!Number.isNaN(lim) && lim >= 0) {
                openPRs = openPRs.slice(0, lim);
            }
        }

        if (openPRs.length === 0) {
            const plan: MergePlan = { base: trunk, generatedFor: repoSlug, plan: [] };
            if (options.json) {
                console.log(JSON.stringify(plan, null, 2));
            } else {
                console.log(renderHumanPlan(plan));
            }
            return;
        }

        // 4. Gather facts (bounded concurrency).
        const facts = await gatherFacts(openPRs, trunk, repoSlug);

        // 5. Build ordered plan + verdicts (pure).
        const plan = buildMergePlan(facts, trunk, repoSlug);

        // 6. Emit. Always exit 0.
        if (options.json) {
            const json = {
                base: plan.base,
                generatedFor: plan.generatedFor,
                plan: plan.plan.map((e) => ({
                    number: e.number,
                    title: e.title,
                    verdict: e.verdict,
                    base: e.base,
                    head: e.head,
                    mergeStateStatus: e.mergeStateStatus,
                    mergeable: e.mergeable,
                    behind: e.behind,
                    stale: e.stale,
                    conflicts: e.conflicts,
                    stackedOn: e.stackedOn,
                    advisories: e.advisories,
                })),
            };
            console.log(JSON.stringify(json, null, 2));
            return;
        }

        console.log(renderHumanPlan(plan));
    });
