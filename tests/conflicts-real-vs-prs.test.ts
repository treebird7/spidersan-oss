/**
 * sp-a1l3 — `conflicts --real --vs-prs` must run BOTH halves.
 *
 * The defect: `options.real` short-circuited into runRealConflicts() and
 * returned, so the --vs-prs cross-PR/overlap block was never reached. The
 * documented authoritative pre-merge check (`conflicts --pr <N> --real
 * --vs-prs`) therefore printed only "clean vs trunk" and exited 0 while doing
 * half its job — a check that reports success while doing nothing.
 *
 * These tests assert by EFFECT, not by output wording: the discriminator is
 * whether the cross-PR path actually consulted GitHub (listOpenPRs) in the
 * same invocation that ran the merge-tree analyzer. A green run of the real
 * half alone cannot satisfy them.
 *
 * They also pin the three behaviours that must NOT regress:
 *   --real alone, --pr N alone, and --vs-prs alone.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { analyzeRealConflicts } from '../src/lib/git-merge-analyzer';
import { getTrunkBranch } from '../src/lib/trunk';
import { getStorage } from '../src/storage/index';
import { listOpenPRs, getPRChangedFiles } from '../src/lib/github';
import { execFileSync } from 'child_process';
import type { RealConflictReport } from '../src/lib/git-merge-analyzer';

vi.mock('../src/lib/git-merge-analyzer', () => ({
    analyzeRealConflicts: vi.fn(),
}));

vi.mock('../src/lib/trunk', () => ({
    getTrunkBranch: vi.fn(),
}));

vi.mock('../src/storage/index', () => ({
    getStorage: vi.fn(),
}));

vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
    spawnSync: vi.fn(),
}));

vi.mock('../src/lib/github', () => ({
    isGhAvailable: vi.fn(() => true),
    getPRLabels: vi.fn(async () => []),
    getPRDetails: vi.fn(async () => ({ number: 81, title: 'pr title', headBranch: 'feat/pr-head', files: ['src/a.ts'] })),
    listOpenPRs: vi.fn(async () => []),
    getPRChangedFiles: vi.fn(async () => []),
}));

vi.mock('../src/lib/carries', () => ({
    analyzeCarries: vi.fn(() => ({ own: [], inherited: [], flagged: false })),
}));

vi.mock('../src/lib/config', () => ({
    loadConfig: vi.fn(async () => ({})),
}));

vi.mock('../src/lib/activity', () => ({
    logActivity: vi.fn(),
}));

// Cross-machine pull is fail-open; no credentials => no remote branches, not degraded.
vi.mock('../src/lib/supabase-credentials', () => ({
    resolveSupabaseCredentials: vi.fn(async () => null),
}));

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__exit:${code ?? 0}`);
}) as never);

function logged(): string {
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}
function errored(): string {
    return errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}

function makeReport(over: Partial<RealConflictReport> = {}): RealConflictReport {
    return {
        base: 'main',
        branch: 'feat/current',
        mergeBase: 'abc123',
        conflicts: [],
        clean: true,
        method: 'write-tree',
        ...over,
    };
}

/** A registry holding the current branch, so the overlap pass has a target. */
function mockRegistry(files = ['src/a.ts']) {
    const storage = {
        isInitialized: vi.fn().mockResolvedValue(true),
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn().mockResolvedValue({ name: 'feat/current', status: 'active', files }),
    };
    (getStorage as Mock).mockResolvedValue(storage);
    return storage;
}

/**
 * Commander persists parsed option values on the reused Command instance across
 * parseAsync calls, so each run starts from a clean slate. Declared defaults
 * (notably `--tier 1`) have to be re-seeded: without them options.tier is
 * undefined, minTier becomes NaN and every tier comparison silently fails —
 * which would make these tests pass for the wrong reason.
 */
function resetOptions(): void {
    const cmd = conflictsCommand as unknown as {
        _optionValues: Record<string, unknown>;
        options: Array<{ defaultValue?: unknown; attributeName(): string }>;
    };
    cmd._optionValues = {};
    for (const opt of cmd.options) {
        if (opt.defaultValue !== undefined) cmd._optionValues[opt.attributeName()] = opt.defaultValue;
    }
}

async function run(args: string[]): Promise<number> {
    resetOptions();
    try {
        await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', ...args]);
        return 0;
    } catch (err) {
        const m = /^__exit:(\d+)$/.exec((err as Error).message);
        if (m) return Number(m[1]);
        throw err;
    }
}

describe('conflicts --real --vs-prs (sp-a1l3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        (getTrunkBranch as Mock).mockReturnValue('main');
        (execFileSync as Mock).mockImplementation((_cmd: string, args?: string[]) => {
            if (Array.isArray(args) && args.includes('--is-ancestor')) {
                throw new Error('not an ancestor');
            }
            // resolveBranchRef() probes refs/remotes/origin/<trunk>: succeeding
            // means the remote trunk exists, so --real merges into it (sp-vifo).
            if (Array.isArray(args) && args.includes('--verify')) {
                return '';
            }
            return 'feat/current\n';
        });
        (analyzeRealConflicts as Mock).mockResolvedValue(makeReport());
        (listOpenPRs as Mock).mockResolvedValue([]);
        (getPRChangedFiles as Mock).mockResolvedValue([]);
    });

    it('runs BOTH halves: merge-tree analyzer AND the cross-PR lookup', async () => {
        mockRegistry(['src/a.ts']);
        (listOpenPRs as Mock).mockResolvedValue([
            { number: 64, title: 'other work', headBranch: 'other/branch', draft: false },
        ]);
        (getPRChangedFiles as Mock).mockResolvedValue(['src/a.ts']);

        const code = await run(['--real', '--vs-prs']);

        expect(code).toBe(0);
        // The real half ran…
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'feat/current');
        expect(logged()).toContain('clean vs main');
        // …and so did the cross-PR half, in the same invocation. This is the
        // discriminator: before the fix listOpenPRs was never called.
        expect(listOpenPRs).toHaveBeenCalled();
        expect(logged()).toContain('PR #64 (other/branch)');
        expect(logged()).toContain('src/a.ts');
    });

    it('composes exit codes: a real conflict under --exit-code still exits 1 after the overlap pass', async () => {
        mockRegistry([]);
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ clean: false, conflicts: [{ file: 'install.sh', kind: 'content' }] }),
        );

        const code = await run(['--real', '--vs-prs', '--exit-code']);

        expect(code).toBe(1);
        // The overlap half was not skipped just because the real half failed.
        expect(listOpenPRs).toHaveBeenCalled();
    });

    it('composes exit codes: overlap under --strict exits 1 even when the real half is clean', async () => {
        // src/lib/auth.ts matches DEFAULT_TIER_3_PATTERNS; --strict blocks on TIER 2+.
        mockRegistry(['src/lib/auth.ts']);
        (listOpenPRs as Mock).mockResolvedValue([
            { number: 70, title: 'auth work', headBranch: 'other/auth', draft: false },
        ]);
        (getPRChangedFiles as Mock).mockResolvedValue(['src/lib/auth.ts']);

        const code = await run(['--real', '--vs-prs', '--strict']);

        expect(code).toBe(1);
        expect(analyzeRealConflicts).toHaveBeenCalled();
        expect(logged()).toContain('clean vs main');
    });

    it('degrades loudly (not fatally) when the branch is not registered', async () => {
        const storage = {
            isInitialized: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([]),
            get: vi.fn().mockResolvedValue(undefined),
        };
        (getStorage as Mock).mockResolvedValue(storage);

        const code = await run(['--real', '--vs-prs']);

        // --real is registry-independent; adding --vs-prs must not make it fatal…
        expect(code).toBe(0);
        expect(logged()).toContain('clean vs main');
        // …but the skipped half must be announced, never silently dropped.
        expect(errored()).toContain('did NOT run');
    });

    it('--pr N --real --vs-prs runs both halves against the PR head', async () => {
        mockRegistry([]);
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ base: 'origin/main', branch: 'refs/spidersan/pr-81' }),
        );
        (listOpenPRs as Mock).mockResolvedValue([
            { number: 64, title: 'other work', headBranch: 'other/branch', draft: false },
        ]);
        (getPRChangedFiles as Mock).mockResolvedValue(['src/a.ts']);

        const code = await run(['--pr', '81', '--real', '--vs-prs']);

        expect(code).toBe(0);
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'refs/spidersan/pr-81');
        expect(listOpenPRs).toHaveBeenCalled();
        // getPRDetails supplies the overlap half's target files (src/a.ts).
        expect(logged()).toContain('PR #64 (other/branch)');
    });

    // ── no-regression pins ───────────────────────────────────────────────────

    it('--real alone still short-circuits: no registry, no gh', async () => {
        const code = await run(['--real']);

        expect(code).toBe(0);
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'feat/current');
        expect(getStorage).not.toHaveBeenCalled();
        expect(listOpenPRs).not.toHaveBeenCalled();
    });

    it('--pr N alone still defaults to the real path only', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ base: 'origin/main', branch: 'refs/spidersan/pr-81' }),
        );

        const code = await run(['--pr', '81']);

        expect(code).toBe(0);
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'refs/spidersan/pr-81');
        expect(listOpenPRs).not.toHaveBeenCalled();
    });

    it('--vs-prs alone still runs only the overlap path', async () => {
        mockRegistry(['src/a.ts']);
        (listOpenPRs as Mock).mockResolvedValue([
            { number: 64, title: 'other work', headBranch: 'other/branch', draft: false },
        ]);
        (getPRChangedFiles as Mock).mockResolvedValue(['src/a.ts']);

        const code = await run(['--vs-prs']);

        expect(code).toBe(0);
        expect(analyzeRealConflicts).not.toHaveBeenCalled();
        expect(listOpenPRs).toHaveBeenCalled();
        expect(logged()).toContain('PR #64 (other/branch)');
    });
});
