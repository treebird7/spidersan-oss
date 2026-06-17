import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
}));

import {
    getPRMergeState,
    getAheadBehind,
    __setUnknownRepollDelayForTests,
    type PRMergeState,
} from '../src/lib/github.js';

const mockExecFileSync = vi.mocked(execFileSync);

// Keep the UNKNOWN re-poll instantaneous so the suite stays fast.
__setUnknownRepollDelayForTests(0);

/** True when the gh invocation is the `gh pr view --json …` merge-state call. */
function isPrViewCall(args: unknown): boolean {
    return Array.isArray(args) && args[0] === 'pr' && args[1] === 'view';
}

/** True when the gh invocation is the `gh auth status` availability probe. */
function isAuthStatusCall(args: unknown): boolean {
    return Array.isArray(args) && args[0] === 'auth' && args[1] === 'status';
}

/**
 * Route the mocked execFileSync: `gh auth status` succeeds (gh available),
 * `gh pr view` returns the next recorded payload from the queue.
 * Each queued entry is a JSON string, or an Error to throw (PR-not-found).
 */
function routeGh(prViewPayloads: (string | Error)[], opts: { ghAvailable?: boolean } = {}) {
    const queue = [...prViewPayloads];
    mockExecFileSync.mockImplementation(((_cmd: string, args: unknown) => {
        if (isAuthStatusCall(args)) {
            if (opts.ghAvailable === false) throw new Error('not logged in');
            return '';
        }
        if (isPrViewCall(args)) {
            const next = queue.shift();
            if (next === undefined) throw new Error('no more pr view payloads queued');
            if (next instanceof Error) throw next;
            return next;
        }
        throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
    }) as unknown as typeof execFileSync);
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('getPRMergeState', () => {
    it('surfaces a stacked base (base != main) for a CLEAN/MERGEABLE PR', async () => {
        const payload = JSON.stringify({
            number: 179,
            title: 'Stacked feature',
            baseRefName: 'feat/parent-branch',
            headRefName: 'feat/child-branch',
            headRefOid: 'abc1234',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
            statusCheckRollup: [
                { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
            ],
        });
        routeGh([payload]);

        const state = (await getPRMergeState(179)) as PRMergeState;
        expect(state).not.toBeNull();
        expect(state.baseRefName).toBe('feat/parent-branch');
        expect(state.headRefName).toBe('feat/child-branch');
        expect(state.mergeable).toBe('MERGEABLE');
        expect(state.mergeStateStatus).toBe('CLEAN');
        expect(state.headRefOid).toBe('abc1234');
        expect(state.checkRollup).toEqual({ pass: 1, fail: 0, pending: 0, failingRequired: [] });

        // Single gh pr view call (no re-poll, mergeable was known).
        const prViewCalls = mockExecFileSync.mock.calls.filter(c => isPrViewCall(c[1]));
        expect(prViewCalls).toHaveLength(1);
    });

    it('passes --repo when opts.repo is provided', async () => {
        const payload = JSON.stringify({
            number: 5,
            title: 'x',
            baseRefName: 'main',
            headRefName: 'f',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
            statusCheckRollup: [],
        });
        routeGh([payload]);

        await getPRMergeState(5, { repo: 'acme/widgets' });

        const prViewCall = mockExecFileSync.mock.calls.find(c => isPrViewCall(c[1]))!;
        const args = prViewCall[1] as string[];
        expect(args).toContain('--repo');
        expect(args[args.indexOf('--repo') + 1]).toBe('acme/widgets');
        // PR number passed after the `--` arg separator.
        expect(args[args.length - 1]).toBe('5');
    });

    it('UNSTABLE with a failing NON-required check buckets fail but leaves failingRequired empty', async () => {
        const payload = JSON.stringify({
            number: 175,
            title: 'Unstable PR',
            baseRefName: 'main',
            headRefName: 'feat/unstable',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'UNSTABLE',
            statusCheckRollup: [
                { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
                // failing, but isRequired absent → required defaults to false
                { name: 'flaky-e2e', status: 'COMPLETED', conclusion: 'FAILURE' },
            ],
        });
        routeGh([payload]);

        const state = (await getPRMergeState(175)) as PRMergeState;
        expect(state.mergeStateStatus).toBe('UNSTABLE');
        expect(state.checkRollup.fail).toBe(1);
        expect(state.checkRollup.pass).toBe(1);
        expect(state.checkRollup.failingRequired).toEqual([]);

        const failing = state.checks.find(c => c.name === 'flaky-e2e')!;
        expect(failing.bucket).toBe('fail');
        expect(failing.required).toBe(false);
    });

    it('feeds failingRequired only when a failing check is required', async () => {
        const payload = JSON.stringify({
            number: 200,
            title: 'Required check failing',
            baseRefName: 'main',
            headRefName: 'feat/req-fail',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'BLOCKED',
            statusCheckRollup: [
                { name: 'required-ci', status: 'COMPLETED', conclusion: 'FAILURE', isRequired: true },
                { name: 'optional-ci', status: 'COMPLETED', conclusion: 'FAILURE', isRequired: false },
            ],
        });
        routeGh([payload]);

        const state = (await getPRMergeState(200)) as PRMergeState;
        expect(state.checkRollup.fail).toBe(2);
        expect(state.checkRollup.failingRequired).toEqual(['required-ci']);
    });

    it('reports CONFLICTING for a DIRTY PR', async () => {
        const payload = JSON.stringify({
            number: 88,
            title: 'Conflicting PR',
            baseRefName: 'main',
            headRefName: 'feat/conflict',
            mergeable: 'CONFLICTING',
            mergeStateStatus: 'DIRTY',
            statusCheckRollup: [],
        });
        routeGh([payload]);

        const state = (await getPRMergeState(88)) as PRMergeState;
        expect(state.mergeable).toBe('CONFLICTING');
        expect(state.mergeStateStatus).toBe('DIRTY');
    });

    it('re-polls exactly once when mergeable is UNKNOWN, then reports as-is', async () => {
        const first = JSON.stringify({
            number: 42,
            title: 'Async mergeability',
            baseRefName: 'main',
            headRefName: 'feat/async',
            mergeable: 'UNKNOWN',
            mergeStateStatus: 'UNKNOWN',
            statusCheckRollup: [],
        });
        const second = JSON.stringify({
            number: 42,
            title: 'Async mergeability',
            baseRefName: 'main',
            headRefName: 'feat/async',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'CLEAN',
            statusCheckRollup: [],
        });
        routeGh([first, second]);

        const state = (await getPRMergeState(42)) as PRMergeState;
        // Second poll's value is reported.
        expect(state.mergeable).toBe('MERGEABLE');
        expect(state.mergeStateStatus).toBe('CLEAN');

        const prViewCalls = mockExecFileSync.mock.calls.filter(c => isPrViewCall(c[1]));
        expect(prViewCalls).toHaveLength(2); // original + one re-poll
    });

    it('re-polls only once even when mergeable stays UNKNOWN, reporting UNKNOWN', async () => {
        const stillUnknown = JSON.stringify({
            number: 43,
            title: 'Never resolves',
            baseRefName: 'main',
            headRefName: 'feat/never',
            mergeable: 'UNKNOWN',
            mergeStateStatus: 'UNKNOWN',
            statusCheckRollup: [],
        });
        routeGh([stillUnknown, stillUnknown]);

        const state = (await getPRMergeState(43)) as PRMergeState;
        expect(state.mergeable).toBe('UNKNOWN');

        const prViewCalls = mockExecFileSync.mock.calls.filter(c => isPrViewCall(c[1]));
        expect(prViewCalls).toHaveLength(2); // original + exactly one re-poll, no more
    });

    it('returns null when gh is unavailable', async () => {
        routeGh([], { ghAvailable: false });

        const state = await getPRMergeState(1);
        expect(state).toBeNull();

        // Never reached the pr view call.
        const prViewCalls = mockExecFileSync.mock.calls.filter(c => isPrViewCall(c[1]));
        expect(prViewCalls).toHaveLength(0);
    });

    it('returns null when the PR is not found (gh pr view throws)', async () => {
        routeGh([new Error('GraphQL: Could not resolve to a PullRequest')]);

        const state = await getPRMergeState(99999);
        expect(state).toBeNull();
    });

    it('does not crash on heterogeneous nodes missing isRequired/conclusion', async () => {
        const payload = JSON.stringify({
            number: 7,
            title: 'Heterogeneous rollup',
            baseRefName: 'main',
            headRefName: 'feat/hetero',
            mergeable: 'MERGEABLE',
            mergeStateStatus: 'UNSTABLE',
            statusCheckRollup: [
                // StatusContext: uses `state`, has `context` not `name`, no isRequired/conclusion
                { context: 'legacy/status-context', state: 'SUCCESS' },
                // CheckRun in progress: null conclusion, status only
                { name: 'in-progress', status: 'IN_PROGRESS', conclusion: null },
                // failing legacy status context (state=FAILURE), no isRequired
                { context: 'legacy/failing', state: 'FAILURE' },
                // skipped check
                { name: 'skipped-check', status: 'COMPLETED', conclusion: 'SKIPPED' },
                // entirely empty node — must not throw, defaults to pending
                {},
                // null entry guarded
                null,
            ],
        });
        routeGh([payload]);

        const state = (await getPRMergeState(7)) as PRMergeState;
        expect(state).not.toBeNull();

        // legacy/status-context → pass; in-progress → pending; legacy/failing → fail;
        // skipped-check → skipping (not counted); {} → pending.
        expect(state.checkRollup.pass).toBe(1);
        expect(state.checkRollup.fail).toBe(1);
        expect(state.checkRollup.pending).toBe(2);
        // No required flags present → failingRequired empty.
        expect(state.checkRollup.failingRequired).toEqual([]);

        // The node missing both name and context falls back to 'unknown'.
        const unknownNode = state.checks.find(c => c.name === 'unknown');
        expect(unknownNode).toBeDefined();
        expect(unknownNode!.bucket).toBe('pending');

        // StatusContext surfaced under its `context` value as the name.
        expect(state.checks.some(c => c.name === 'legacy/status-context' && c.bucket === 'pass')).toBe(true);
        expect(state.checks.some(c => c.name === 'legacy/failing' && c.bucket === 'fail')).toBe(true);
    });
});

describe('getAheadBehind', () => {
    const config = { owner: 'treebird7', repo: 'spidersan' };

    /** Route the `gh api …/compare/…` call to a single payload (string) or thrown Error. */
    function routeCompare(payload: string | Error) {
        mockExecFileSync.mockImplementation(((_cmd: string, args: unknown) => {
            const a = args as string[];
            if (Array.isArray(a) && a[0] === 'api' && String(a[1]).includes('/compare/')) {
                if (payload instanceof Error) throw payload;
                return payload;
            }
            throw new Error(`unexpected gh call: ${JSON.stringify(args)}`);
        }) as unknown as typeof execFileSync);
    }

    it('returns parsed counts when the branch is diverged', async () => {
        routeCompare(JSON.stringify({ ahead: 3, behind: 5 }));
        expect(await getAheadBehind(config, 'feat/x')).toEqual({ ahead: 3, behind: 5 });
    });

    it('returns {0,0} only when the branch is GENUINELY in sync', async () => {
        routeCompare(JSON.stringify({ ahead: 0, behind: 0 }));
        expect(await getAheadBehind(config, 'feat/x')).toEqual({ ahead: 0, behind: 0 });
    });

    it('returns null (NOT {0,0}) on a gh failure — e.g. rate-limit / 403', async () => {
        routeCompare(new Error('HTTP 403: API rate limit exceeded'));
        // The whole point of the fix: a failed compare must be distinguishable
        // from an in-sync branch so callers never mislabel a diverged branch.
        expect(await getAheadBehind(config, 'feat/x')).toBeNull();
    });

    it('returns null on unparseable output', async () => {
        routeCompare('not json');
        expect(await getAheadBehind(config, 'feat/x')).toBeNull();
    });

    it('returns null on a non-numeric compare result', async () => {
        routeCompare(JSON.stringify({ ahead: null, behind: null }));
        expect(await getAheadBehind(config, 'feat/x')).toBeNull();
    });

    it('returns null on an invalid branch name without spawning gh', async () => {
        routeCompare(new Error('should not be called'));
        expect(await getAheadBehind(config, 'evil; rm -rf ~')).toBeNull();
        expect(mockExecFileSync).not.toHaveBeenCalled();
    });
});
