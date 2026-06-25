import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock child_process so resolveRepoSlug + fetchPRHead never shell out.
vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

// Mock the Phase-A foundations the command consumes — NEVER hit network/git/registry.
vi.mock('../src/lib/github.js', () => ({
    isGhAvailable: vi.fn(() => true),
    listPullRequests: vi.fn(),
    getPRMergeState: vi.fn(),
    getAheadBehind: vi.fn(async () => ({ ahead: 0, behind: 0 })),
}));
vi.mock('../src/lib/git-merge-analyzer.js', () => ({
    analyzeRealConflicts: vi.fn(),
}));
vi.mock('../src/lib/trunk.js', () => ({
    getTrunkBranch: vi.fn(() => 'main'),
}));

import { execFileSync } from 'child_process';
import {
    mergePlanCommand,
    buildMergePlan,
    type PRFacts,
} from '../src/commands/merge-plan.js';
import {
    isGhAvailable,
    listPullRequests,
    getPRMergeState,
    getAheadBehind,
    type GitHubPRInfo,
    type PRMergeState,
} from '../src/lib/github.js';
import { analyzeRealConflicts, type RealConflictReport } from '../src/lib/git-merge-analyzer.js';
import { getTrunkBranch } from '../src/lib/trunk.js';

const mockExecFileSync = vi.mocked(execFileSync);
const mockIsGhAvailable = vi.mocked(isGhAvailable);
const mockListPullRequests = vi.mocked(listPullRequests);
const mockGetPRMergeState = vi.mocked(getPRMergeState);
const mockGetAheadBehind = vi.mocked(getAheadBehind);
const mockAnalyzeRealConflicts = vi.mocked(analyzeRealConflicts);
const mockGetTrunkBranch = vi.mocked(getTrunkBranch);

// ── Fact builders ───────────────────────────────────────────────────────────

function makeFacts(overrides: Partial<PRFacts> = {}): PRFacts {
    return {
        number: 100,
        title: 'Test PR',
        base: 'main',
        head: 'feat/test',
        headRefOid: 'sha-100',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        failingRequired: [],
        behind: 0,
        conflictFiles: [],
        ...overrides,
    };
}

/** The golden example facts: #175 clean, #179 conflicted, #181 stacked on #179. */
function goldenFacts(): PRFacts[] {
    return [
        makeFacts({
            number: 175,
            title: 'password reset',
            base: 'main',
            head: 'feat/password-reset',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
        }),
        makeFacts({
            number: 179,
            title: 'checkout redesign',
            base: 'main',
            head: 'feat/checkout-redesign',
            mergeable: 'CONFLICTING',
            mergeStateStatus: 'DIRTY',
            conflictFiles: ['src/components/CheckoutScreen.tsx'],
        }),
        makeFacts({
            number: 181,
            title: 'coupon support',
            // base == #179's head ⇒ stacked child
            base: 'feat/checkout-redesign',
            head: 'feat/coupon-support',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
        }),
    ];
}

// ── Command runner (captures stdout + exit code) ─────────────────────────────

function makePR(overrides: Partial<GitHubPRInfo> = {}): GitHubPRInfo {
    return {
        number: 100,
        title: 'PR',
        state: 'OPEN',
        headBranch: 'feat/x',
        draft: false,
        createdAt: '',
        updatedAt: '',
        ...overrides,
    };
}

function makeState(overrides: Partial<PRMergeState> = {}): PRMergeState {
    return {
        number: 100,
        title: 'PR',
        baseRefName: 'main',
        headRefName: 'feat/x',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        checks: [],
        checkRollup: { pass: 0, fail: 0, pending: 0, failingRequired: [] },
        headRefOid: 'sha-x',
        ...overrides,
    };
}

function cleanReport(): RealConflictReport {
    return {
        base: 'main',
        branch: 'feat/x',
        mergeBase: 'base-sha',
        conflicts: [],
        clean: true,
        method: 'write-tree',
    };
}

function conflictReport(files: string[]): RealConflictReport {
    return {
        base: 'main',
        branch: 'feat/x',
        mergeBase: 'base-sha',
        conflicts: files.map((file) => ({ file, kind: 'content' as const })),
        clean: false,
        method: 'write-tree',
    };
}

async function runMergePlan(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });

    let exitCode: number | undefined;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCode = code;
        throw new Error(`__exit__:${code}`);
    }) as never);

    try {
        await mergePlanCommand.parseAsync(['node', 'merge-plan', ...args]);
    } catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith('__exit__:')) throw err;
    } finally {
        logSpy.mockRestore();
        exitSpy.mockRestore();
    }

    return { out: logs.join('\n'), exitCode };
}

/** Route the (mocked) child_process: gh repo view → slug; git fetch → ok. */
function routeChildProcess() {
    mockExecFileSync.mockImplementation(((cmd: string, args: unknown) => {
        const a = args as string[];
        if (cmd === 'gh' && a[0] === 'repo' && a[1] === 'view') {
            return JSON.stringify({ owner: { login: 'acme' }, name: 'storefront' });
        }
        if (cmd === 'git' && a[0] === 'fetch') {
            return '';
        }
        return '';
    }) as unknown as typeof execFileSync);
}

beforeEach(() => {
    vi.clearAllMocks();
    mockGetTrunkBranch.mockReturnValue('main');
    mockIsGhAvailable.mockReturnValue(true);
    mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 0 });
    routeChildProcess();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// buildMergePlan — pure ordering + verdicts (GOLDEN CASE)
// ═══════════════════════════════════════════════════════════════════════════

describe('buildMergePlan (pure) — golden #175/#179/#181', () => {
    it('#175 → MERGE and ordered first', () => {
        const plan = buildMergePlan(goldenFacts(), 'main', 'acme/storefront');
        const e175 = plan.plan.find((p) => p.number === 175)!;
        expect(e175.verdict).toBe('MERGE');
        expect(plan.plan[0].number).toBe(175);
    });

    it('#179 → BLOCKED with the real conflict file surfaced', () => {
        const plan = buildMergePlan(goldenFacts(), 'main', 'acme/storefront');
        const e179 = plan.plan.find((p) => p.number === 179)!;
        expect(e179.verdict).toBe('BLOCKED');
        expect(e179.conflicts).toContain('src/components/CheckoutScreen.tsx');
        expect(e179.reason).toContain('src/components/CheckoutScreen.tsx');
    });

    it('#181 → WAIT stacked on #179 with retarget advisory', () => {
        const plan = buildMergePlan(goldenFacts(), 'main', 'acme/storefront');
        const e181 = plan.plan.find((p) => p.number === 181)!;
        expect(e181.verdict).toBe('WAIT');
        expect(e181.stackedOn).toBe(179);
        expect(e181.reason).toContain('#179');
        expect(e181.advisories.some((a) => a.includes('retarget') && a.includes('main'))).toBe(true);
    });

    it('parent #179 precedes child #181 in the order', () => {
        const plan = buildMergePlan(goldenFacts(), 'main', 'acme/storefront');
        const order = plan.plan.map((p) => p.number);
        expect(order.indexOf(179)).toBeLessThan(order.indexOf(181));
    });

    it('full golden order is [175, 179, 181]', () => {
        const plan = buildMergePlan(goldenFacts(), 'main', 'acme/storefront');
        expect(plan.plan.map((p) => p.number)).toEqual([175, 179, 181]);
        expect(plan.base).toBe('main');
        expect(plan.generatedFor).toBe('acme/storefront');
    });
});

describe('buildMergePlan (pure) — chained stack (regression: re-sort must not cross stack edges)', () => {
    // gp(#1, base main) → p(#2, base gp.head, behind 9) → c(#3, base p.head, behind 0).
    // #2 and #3 are BOTH stacked (rank 4); the old `behind`-ascending tiebreak flipped
    // child #3 ahead of parent #2. Topo order must win between two stacked PRs.
    function chainedFacts(): PRFacts[] {
        return [
            makeFacts({ number: 1, base: 'main', head: 'branchA', mergeStateStatus: 'CLEAN', behind: 0 }),
            makeFacts({ number: 2, base: 'branchA', head: 'branchB', mergeStateStatus: 'CLEAN', behind: 9 }),
            makeFacts({ number: 3, base: 'branchB', head: 'branchC', mergeStateStatus: 'CLEAN', behind: 0 }),
        ];
    }

    it('parent precedes child in a 3-level stack despite a higher parent behind-count', () => {
        const plan = buildMergePlan(chainedFacts(), 'main', 'r/x');
        const order = plan.plan.map((p) => p.number);
        expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
        expect(order).toEqual([1, 2, 3]);
    });
});

describe('buildMergePlan (pure) — verdict + staleness edges', () => {
    it('sets stale + advisory when behind > 0', () => {
        const facts = [makeFacts({ number: 5, behind: 3, mergeStateStatus: 'CLEAN' })];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        const e = plan.plan[0];
        expect(e.stale).toBe(true);
        expect(e.behind).toBe(3);
        // A clean-but-behind PR gets the STALE verdict, with a behind advisory.
        expect(e.verdict).toBe('STALE');
        expect(e.advisories.some((a) => a.includes('3 commit'))).toBe(true);
    });

    it('sets stale when mergeStateStatus === BEHIND even if behind count is 0', () => {
        const facts = [makeFacts({ number: 6, behind: 0, mergeStateStatus: 'BEHIND' })];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        expect(plan.plan[0].stale).toBe(true);
    });

    it('a failing REQUIRED check → VERIFY with the check named', () => {
        const facts = [makeFacts({
            number: 7,
            mergeStateStatus: 'BLOCKED',
            failingRequired: ['build'],
        })];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        expect(plan.plan[0].verdict).toBe('VERIFY');
        expect(plan.plan[0].reason).toContain('build');
    });

    it('UNKNOWN mergeability → UNKNOWN verdict', () => {
        const facts = [makeFacts({ number: 8, mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' })];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        expect(plan.plan[0].verdict).toBe('UNKNOWN');
    });

    it('UNSTABLE (only non-required checks red) still → MERGE', () => {
        const facts = [makeFacts({ number: 9, mergeStateStatus: 'UNSTABLE', failingRequired: [] })];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        expect(plan.plan[0].verdict).toBe('MERGE');
    });

    it('STALE + UNSTABLE → STALE headline but annotates the suppressed check axis (tb-cdz)', () => {
        const facts = [makeFacts({
            number: 10,
            behind: 4,
            mergeStateStatus: 'UNSTABLE',
            failingRequired: [],
        })];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        const e = plan.plan[0];
        // STALE outranks UNSTABLE for the headline...
        expect(e.verdict).toBe('STALE');
        // ...but the red-check signal must not be dropped (additive, not lossy).
        expect(e.advisories.some((a) => a.includes('4 commit'))).toBe(true);
        expect(e.advisories.some((a) => a.includes('non-required checks red'))).toBe(true);
    });

    it('a clean PR sorts ahead of a stale one', () => {
        const facts = [
            makeFacts({ number: 20, behind: 5, mergeStateStatus: 'CLEAN', head: 'feat/stale' }),
            makeFacts({ number: 21, behind: 0, mergeStateStatus: 'CLEAN', head: 'feat/clean' }),
        ];
        const plan = buildMergePlan(facts, 'main', 'r/x');
        expect(plan.plan[0].number).toBe(21); // clean+current first
        expect(plan.plan[1].number).toBe(20);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// mergePlanCommand — integration (mocked libs, captured stdout)
// ═══════════════════════════════════════════════════════════════════════════

describe('merge-plan command', () => {
    it('renders the golden human plan: #175 MERGE, #179 BLOCKED, #181 WAIT, in order', async () => {
        mockListPullRequests.mockResolvedValue([
            makePR({ number: 175, title: 'password reset', headBranch: 'feat/password-reset' }),
            makePR({ number: 179, title: 'checkout redesign', headBranch: 'feat/checkout-redesign' }),
            makePR({ number: 181, title: 'coupon support', headBranch: 'feat/coupon-support' }),
        ]);
        mockGetPRMergeState.mockImplementation(async (n: number) => {
            if (n === 175) return makeState({ number: 175, baseRefName: 'main', headRefName: 'feat/password-reset', headRefOid: 'sha175' });
            if (n === 179) return makeState({ number: 179, baseRefName: 'main', headRefName: 'feat/checkout-redesign', mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY', headRefOid: 'sha179' });
            if (n === 181) return makeState({ number: 181, baseRefName: 'feat/checkout-redesign', headRefName: 'feat/coupon-support', headRefOid: 'sha181' });
            return null;
        });
        mockAnalyzeRealConflicts.mockImplementation(async (_base: string, head: string) => {
            if (head === 'sha179') return conflictReport(['src/components/CheckoutScreen.tsx']);
            return cleanReport();
        });

        const { out, exitCode } = await runMergePlan([]);
        expect(exitCode).toBeUndefined(); // exit 0 (no process.exit)

        // Order: #175 line precedes #179 precedes #181.
        const i175 = out.indexOf('#175');
        const i179 = out.indexOf('#179');
        const i181 = out.indexOf('#181');
        expect(i175).toBeGreaterThanOrEqual(0);
        expect(i175).toBeLessThan(i179);
        expect(i179).toBeLessThan(i181);

        expect(out).toContain('MERGE');
        expect(out).toContain('BLOCKED');
        expect(out).toContain('src/components/CheckoutScreen.tsx');
        expect(out).toContain('WAIT');
        expect(out).toContain('base: main');
    });

    it('--json emits the documented shape', async () => {
        mockListPullRequests.mockResolvedValue([
            makePR({ number: 175, title: 'password reset', headBranch: 'feat/password-reset' }),
        ]);
        mockGetPRMergeState.mockResolvedValue(
            makeState({ number: 175, baseRefName: 'main', headRefName: 'feat/password-reset', headRefOid: 'sha175' }),
        );
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        const { out } = await runMergePlan(['--json']);
        const parsed = JSON.parse(out);
        expect(parsed.base).toBe('main');
        expect(parsed.generatedFor).toBe('acme/storefront');
        expect(Array.isArray(parsed.plan)).toBe(true);
        const e = parsed.plan[0];
        expect(e.number).toBe(175);
        expect(e.verdict).toBe('MERGE');
        // Shape keys per spec.
        for (const key of ['number', 'title', 'verdict', 'base', 'head', 'mergeStateStatus', 'mergeable', 'behind', 'stale', 'conflicts', 'stackedOn', 'advisories']) {
            expect(e).toHaveProperty(key);
        }
        expect(Array.isArray(e.conflicts)).toBe(true);
        expect(Array.isArray(e.advisories)).toBe(true);
    });

    it('surfaces stale flag in --json when behind > 0', async () => {
        mockListPullRequests.mockResolvedValue([makePR({ number: 30, headBranch: 'feat/behind' })]);
        mockGetPRMergeState.mockResolvedValue(
            makeState({ number: 30, headRefName: 'feat/behind', headRefOid: 'sha30' }),
        );
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());
        mockGetAheadBehind.mockResolvedValue({ ahead: 1, behind: 4 });

        const { out } = await runMergePlan(['--json']);
        const parsed = JSON.parse(out);
        expect(parsed.plan[0].stale).toBe(true);
        expect(parsed.plan[0].behind).toBe(4);
    });

    it('excludes drafts by default', async () => {
        mockListPullRequests.mockResolvedValue([
            makePR({ number: 40, headBranch: 'feat/ready', draft: false }),
            makePR({ number: 41, headBranch: 'feat/draft', draft: true }),
        ]);
        mockGetPRMergeState.mockImplementation(async (n: number) =>
            makeState({ number: n, headRefName: `feat/${n}`, headRefOid: `sha${n}` }),
        );
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        const { out } = await runMergePlan(['--json']);
        const parsed = JSON.parse(out);
        const numbers = parsed.plan.map((p: { number: number }) => p.number);
        expect(numbers).toContain(40);
        expect(numbers).not.toContain(41);
        // The draft PR's merge-state was never fetched.
        expect(mockGetPRMergeState).not.toHaveBeenCalledWith(41, expect.anything());
    });

    it('includes drafts with --include-drafts', async () => {
        mockListPullRequests.mockResolvedValue([
            makePR({ number: 41, headBranch: 'feat/draft', draft: true }),
        ]);
        mockGetPRMergeState.mockResolvedValue(
            makeState({ number: 41, headRefName: 'feat/draft', headRefOid: 'sha41' }),
        );
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        const { out } = await runMergePlan(['--json', '--include-drafts']);
        const parsed = JSON.parse(out);
        expect(parsed.plan.map((p: { number: number }) => p.number)).toContain(41);
    });

    it('excludes non-OPEN PRs (lib returns all states)', async () => {
        mockListPullRequests.mockResolvedValue([
            makePR({ number: 50, state: 'OPEN', headBranch: 'feat/open' }),
            makePR({ number: 51, state: 'MERGED', headBranch: 'feat/merged' }),
            makePR({ number: 52, state: 'CLOSED', headBranch: 'feat/closed' }),
        ]);
        mockGetPRMergeState.mockImplementation(async (n: number) =>
            makeState({ number: n, headRefName: `feat/${n}`, headRefOid: `sha${n}` }),
        );
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        const { out } = await runMergePlan(['--json']);
        const parsed = JSON.parse(out);
        const numbers = parsed.plan.map((p: { number: number }) => p.number);
        expect(numbers).toEqual([50]);
    });

    it('honours --limit', async () => {
        mockListPullRequests.mockResolvedValue([
            makePR({ number: 60, headBranch: 'feat/60' }),
            makePR({ number: 61, headBranch: 'feat/61' }),
            makePR({ number: 62, headBranch: 'feat/62' }),
        ]);
        mockGetPRMergeState.mockImplementation(async (n: number) =>
            makeState({ number: n, headRefName: `feat/${n}`, headRefOid: `sha${n}` }),
        );
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        const { out } = await runMergePlan(['--json', '--limit', '2']);
        const parsed = JSON.parse(out);
        expect(parsed.plan).toHaveLength(2);
        expect(parsed.plan.map((p: { number: number }) => p.number)).toEqual([60, 61]);
    });

    it('passes the resolved repo slug to getPRMergeState', async () => {
        mockListPullRequests.mockResolvedValue([makePR({ number: 70, headBranch: 'feat/70' })]);
        mockGetPRMergeState.mockResolvedValue(makeState({ number: 70, headRefName: 'feat/70', headRefOid: 'sha70' }));
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        await runMergePlan([]);
        expect(mockGetPRMergeState).toHaveBeenCalledWith(70, { repo: 'acme/storefront' });
    });

    it('honours --repo override (skips gh repo view)', async () => {
        mockListPullRequests.mockResolvedValue([makePR({ number: 71, headBranch: 'feat/71' })]);
        mockGetPRMergeState.mockResolvedValue(makeState({ number: 71, headRefName: 'feat/71', headRefOid: 'sha71' }));
        mockAnalyzeRealConflicts.mockResolvedValue(cleanReport());

        const { out } = await runMergePlan(['--json', '--repo', 'someone/other-repo']);
        const parsed = JSON.parse(out);
        expect(parsed.generatedFor).toBe('someone/other-repo');
        expect(mockGetPRMergeState).toHaveBeenCalledWith(71, { repo: 'someone/other-repo' });
    });

    it('gh unavailable → friendly message, exit 0, no PR fetch', async () => {
        mockIsGhAvailable.mockReturnValue(false);
        const { out, exitCode } = await runMergePlan([]);
        expect(exitCode).toBeUndefined();
        expect(out.toLowerCase()).toContain('gh');
        expect(mockListPullRequests).not.toHaveBeenCalled();
    });

    it('no open PRs → empty plan, exit 0', async () => {
        mockListPullRequests.mockResolvedValue([]);
        const { out, exitCode } = await runMergePlan(['--json']);
        const parsed = JSON.parse(out);
        expect(parsed.plan).toEqual([]);
        expect(exitCode).toBeUndefined();
    });
});
