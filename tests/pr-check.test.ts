import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Phase-A foundations the command consumes — NEVER hit network/real registry.
vi.mock('../src/lib/github.js', () => ({
    getPRMergeState: vi.fn(),
}));
vi.mock('../src/lib/trunk.js', () => ({
    getTrunkBranch: vi.fn(() => 'main'),
}));

import { prCheckCommand, buildPrCheckAdvisories } from '../src/commands/pr-check.js';
import { getPRMergeState, type PRMergeState } from '../src/lib/github.js';
import { getTrunkBranch } from '../src/lib/trunk.js';

const mockGetPRMergeState = vi.mocked(getPRMergeState);
const mockGetTrunkBranch = vi.mocked(getTrunkBranch);

/** A clean, non-stacked baseline merge state; override fields per test. */
function makeState(overrides: Partial<PRMergeState> = {}): PRMergeState {
    return {
        number: 100,
        title: 'Test PR',
        baseRefName: 'main',
        headRefName: 'feat/test',
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        checks: [],
        checkRollup: { pass: 0, fail: 0, pending: 0, failingRequired: [] },
        ...overrides,
    };
}

/**
 * Run the command's action and capture stdout + the exit code without killing
 * the test process. Returns the joined console.log output and the exit code
 * (undefined if the action returned normally without calling process.exit).
 */
async function runPrCheck(args: string[]): Promise<{ out: string; exitCode: number | undefined }> {
    const logs: string[] = [];
    const errs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...a) => { logs.push(a.join(' ')); });
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...a) => { errs.push(a.join(' ')); });

    let exitCode: number | undefined;
    // process.exit must not terminate the test runner; record + throw a sentinel
    // so the action's control flow stops exactly as a real exit would.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        exitCode = code;
        throw new Error(`__exit__:${code}`);
    }) as never);

    // prCheckCommand is a singleton; clear any option values parsed by a prior
    // run so flags like --exit-code don't leak across tests.
    (prCheckCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};

    try {
        await prCheckCommand.parseAsync(['node', 'pr-check', ...args]);
    } catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith('__exit__:')) throw err;
    } finally {
        logSpy.mockRestore();
        errSpy.mockRestore();
        exitSpy.mockRestore();
    }

    return { out: [...logs, ...errs].join('\n'), exitCode };
}

beforeEach(() => {
    vi.clearAllMocks();
    mockGetTrunkBranch.mockReturnValue('main');
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('buildPrCheckAdvisories (pure)', () => {
    it('reports no advisories for a clean, non-stacked PR', () => {
        const { advisories, stacked } = buildPrCheckAdvisories(makeState(), 'main');
        expect(stacked).toBe(false);
        expect(advisories).toEqual([]);
    });

    it('flags a stacked base (base != trunk)', () => {
        const { advisories, stacked } = buildPrCheckAdvisories(
            makeState({ baseRefName: 'feat/parent' }), 'main',
        );
        expect(stacked).toBe(true);
        expect(advisories).toHaveLength(1);
        expect(advisories[0]).toContain('STACKED PR');
        expect(advisories[0]).toContain('feat/parent');
        expect(advisories[0]).toContain('main');
    });

    it('flags each red/behind/conflict state and includes failingRequired', () => {
        for (const status of ['UNSTABLE', 'DIRTY', 'BEHIND', 'BLOCKED'] as const) {
            const { advisories } = buildPrCheckAdvisories(
                makeState({
                    mergeStateStatus: status,
                    checkRollup: { pass: 0, fail: 1, pending: 0, failingRequired: ['required-ci'] },
                }),
                'main',
            );
            expect(advisories.some(a => a.includes(`state=${status}`))).toBe(true);
            expect(advisories.some(a => a.includes('required-ci'))).toBe(true);
        }
    });

    it('does NOT flag a clean (non-red) status', () => {
        const { advisories } = buildPrCheckAdvisories(makeState({ mergeStateStatus: 'CLEAN' }), 'main');
        expect(advisories).toEqual([]);
    });

    it('combines stacked + red into two advisories', () => {
        const { advisories, stacked } = buildPrCheckAdvisories(
            makeState({ baseRefName: 'develop', mergeStateStatus: 'BLOCKED' }), 'main',
        );
        expect(stacked).toBe(true);
        expect(advisories).toHaveLength(2);
    });
});

describe('pr-check command', () => {
    it('prints "looks clean" and exits 0 for a clean PR', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState({ number: 175 }));
        const { out, exitCode } = await runPrCheck(['175']);
        expect(out).toContain('looks clean');
        expect(out).toContain('#175');
        expect(exitCode).toBeUndefined(); // no process.exit on the clean path
    });

    it('warns on a stacked PR but stays exit 0 (advisory) by default', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState({ baseRefName: 'feat/parent' }));
        const { out, exitCode } = await runPrCheck(['179']);
        expect(out).toContain('STACKED PR');
        expect(exitCode).toBeUndefined();
    });

    it('warns on a red/behind PR with failing required checks', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState({
            mergeStateStatus: 'UNSTABLE',
            checkRollup: { pass: 1, fail: 1, pending: 0, failingRequired: ['build'] },
        }));
        const { out } = await runPrCheck(['175']);
        expect(out).toContain('state=UNSTABLE');
        expect(out).toContain('build');
    });

    it('--exit-code → exit 1 when any advisory fired', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState({ mergeStateStatus: 'DIRTY' }));
        const { exitCode } = await runPrCheck(['88', '--exit-code']);
        expect(exitCode).toBe(1);
    });

    it('--exit-code → no exit (0) when the PR looks clean', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState());
        const { exitCode } = await runPrCheck(['100', '--exit-code']);
        expect(exitCode).toBeUndefined();
    });

    it('null PR (gh unavailable / not found) → friendly message, exit 0', async () => {
        mockGetPRMergeState.mockResolvedValue(null);
        const { out, exitCode } = await runPrCheck(['99999']);
        expect(out).toContain('Could not fetch PR #99999');
        expect(exitCode).toBeUndefined();
    });

    it('null PR with --exit-code → exit 2', async () => {
        mockGetPRMergeState.mockResolvedValue(null);
        const { exitCode } = await runPrCheck(['99999', '--exit-code']);
        expect(exitCode).toBe(2);
    });

    it('--json emits PRMergeState plus { stacked, trunk, advisories }', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState({
            number: 42,
            baseRefName: 'develop',
            mergeStateStatus: 'BEHIND',
            checkRollup: { pass: 0, fail: 1, pending: 0, failingRequired: ['ci'] },
        }));
        mockGetTrunkBranch.mockReturnValue('main');
        const { out } = await runPrCheck(['42', '--json']);
        const parsed = JSON.parse(out);
        expect(parsed.number).toBe(42);
        expect(parsed.mergeStateStatus).toBe('BEHIND');
        expect(parsed.trunk).toBe('main');
        expect(parsed.stacked).toBe(true);
        expect(Array.isArray(parsed.advisories)).toBe(true);
        expect(parsed.advisories.length).toBe(2); // stacked + behind
    });

    it('passes --repo through to getPRMergeState', async () => {
        mockGetPRMergeState.mockResolvedValue(makeState());
        await runPrCheck(['5', '--repo', 'acme/widgets']);
        expect(mockGetPRMergeState).toHaveBeenCalledWith(5, { repo: 'acme/widgets' });
    });

    it('rejects a non-numeric PR argument', async () => {
        const { out, exitCode } = await runPrCheck(['not-a-number']);
        expect(out).toContain('Invalid PR number');
        expect(exitCode).toBeUndefined(); // exit 0 without --exit-code
        expect(mockGetPRMergeState).not.toHaveBeenCalled();
    });
});
