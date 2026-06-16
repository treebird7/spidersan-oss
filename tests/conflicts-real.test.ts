/**
 * B1 — `conflicts --real` (git merge-tree backed) command tests.
 *
 * Mocks the A1 analyzer (`analyzeRealConflicts`), trunk detection
 * (`getTrunkBranch`), storage (`getStorage` for the `--all` path), and
 * `child_process` (for `getCurrentBranch`). Asserts:
 *   - clean → exit 0 + "clean vs <base>"
 *   - conflicts → lists files + kind
 *   - --exit-code → exit 1 when conflicts, 0 when clean
 *   - --json → { base, results } shape
 *   - --all → iterates active registered branches (storage.list())
 *   - error report → printed, does not throw, exit 0
 *   - --base override is passed through to the analyzer
 *   - --real runs even when the registry is NOT initialized (single target)
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { analyzeRealConflicts } from '../src/lib/git-merge-analyzer';
import { getTrunkBranch } from '../src/lib/trunk';
import { getStorage } from '../src/storage/index';
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

// Capture console output instead of cluttering the run.
let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
// process.exit must throw so we can assert the code and stop the action mid-flight.
const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__exit:${code ?? 0}`);
}) as never);

function logged(): string {
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}

function makeReport(over: Partial<RealConflictReport> = {}): RealConflictReport {
    return {
        base: 'main',
        branch: 'feat/x',
        mergeBase: 'abc123',
        conflicts: [],
        clean: true,
        method: 'write-tree',
        ...over,
    };
}

/** Run the action; capture an exit code if process.exit was hit. */
async function run(args: string[]): Promise<number> {
    // Commander persists parsed option values on the reused Command instance
    // across parseAsync calls; wipe them so each test starts clean.
    (conflictsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    try {
        await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', ...args]);
        return 0;
    } catch (err) {
        const m = /^__exit:(\d+)$/.exec((err as Error).message);
        if (m) return Number(m[1]);
        throw err;
    }
}

describe('conflicts --real', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        (getTrunkBranch as Mock).mockReturnValue('main');
        // getCurrentBranch() → execFileSync('git', ['rev-parse', ...])
        (execFileSync as Mock).mockReturnValue('feat/current\n');
    });

    it('clean current branch → exit 0 and prints "clean vs <base>"', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: true }),
        );

        const code = await run(['--real']);

        expect(code).toBe(0);
        expect(exitSpy).not.toHaveBeenCalled();
        expect(analyzeRealConflicts).toHaveBeenCalledWith('main', 'feat/current');
        expect(logged()).toContain('✅ feat/current: clean vs main');
    });

    it('conflicts → lists each file with its kind', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({
                branch: 'feat/current',
                clean: false,
                conflicts: [
                    { file: 'src/a.ts', kind: 'content' },
                    { file: 'docs/new.md', kind: 'add/add' },
                ],
            }),
        );

        await run(['--real']);

        const out = logged();
        expect(out).toContain('⚠️ feat/current: 2 real conflicts vs main');
        expect(out).toContain('src/a.ts (content)');
        expect(out).toContain('docs/new.md (add/add)');
        expect(out).toContain('method: write-tree');
    });

    it('--exit-code flips exit to 1 when conflicts found', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({
                branch: 'feat/current',
                clean: false,
                conflicts: [{ file: 'src/a.ts', kind: 'content' }],
            }),
        );

        const code = await run(['--real', '--exit-code']);

        expect(code).toBe(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('--exit-code stays 0 when clean', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: true }),
        );

        const code = await run(['--real', '--exit-code']);

        expect(code).toBe(0);
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('--json emits { base, results } shape', async () => {
        const report = makeReport({
            branch: 'feat/current',
            clean: false,
            conflicts: [{ file: 'src/a.ts', kind: 'content' }],
        });
        (analyzeRealConflicts as Mock).mockResolvedValue(report);

        await run(['--real', '--json']);

        const parsed = JSON.parse(logged());
        expect(parsed.base).toBe('main');
        expect(Array.isArray(parsed.results)).toBe(true);
        expect(parsed.results).toHaveLength(1);
        expect(parsed.results[0].branch).toBe('feat/current');
        expect(parsed.results[0].conflicts[0]).toEqual({ file: 'src/a.ts', kind: 'content' });
    });

    it('--base overrides the detected trunk', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ base: 'develop', branch: 'feat/current', clean: true }),
        );

        await run(['--real', '--base', 'develop']);

        expect(getTrunkBranch).not.toHaveBeenCalled();
        expect(analyzeRealConflicts).toHaveBeenCalledWith('develop', 'feat/current');
        expect(logged()).toContain('✅ feat/current: clean vs develop');
    });

    it('--branch targets a specific branch (no current-branch lookup)', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/other', clean: true }),
        );

        await run(['--real', '--branch', 'feat/other']);

        expect(execFileSync).not.toHaveBeenCalled();
        expect(analyzeRealConflicts).toHaveBeenCalledWith('main', 'feat/other');
    });

    it('--all iterates only active registered branches', async () => {
        const mockStorage = {
            isInitialized: vi.fn().mockResolvedValue(true),
            list: vi.fn().mockResolvedValue([
                { name: 'feat/a', status: 'active', files: [] },
                { name: 'feat/b', status: 'completed', files: [] },
                { name: 'feat/c', status: 'active', files: [] },
            ]),
        };
        (getStorage as Mock).mockResolvedValue(mockStorage);
        (analyzeRealConflicts as Mock).mockImplementation(
            async (base: string, branch: string) => makeReport({ base, branch, clean: true }),
        );

        const code = await run(['--real', '--all']);

        expect(code).toBe(0);
        // completed branch skipped; active ones checked.
        expect(analyzeRealConflicts).toHaveBeenCalledTimes(2);
        expect(analyzeRealConflicts).toHaveBeenCalledWith('main', 'feat/a');
        expect(analyzeRealConflicts).toHaveBeenCalledWith('main', 'feat/c');
        expect(analyzeRealConflicts).not.toHaveBeenCalledWith('main', 'feat/b');
    });

    it('--all exits 1 when the registry is not initialized', async () => {
        const mockStorage = {
            isInitialized: vi.fn().mockResolvedValue(false),
            list: vi.fn(),
        };
        (getStorage as Mock).mockResolvedValue(mockStorage);

        const code = await run(['--real', '--all']);

        expect(code).toBe(1);
        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(analyzeRealConflicts).not.toHaveBeenCalled();
    });

    it('single-target --real does NOT touch storage (works with no registry)', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: true }),
        );

        await run(['--real']);

        expect(getStorage).not.toHaveBeenCalled();
    });

    it('error report is printed and does not throw; exit stays 0', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: false, error: 'ref not found: main' }),
        );

        const code = await run(['--real']);

        expect(code).toBe(0);
        expect(logged()).toContain('❌ feat/current: ref not found: main');
    });

    it('--exit-code does NOT trip on an env error alone (no real conflicts)', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: false, error: 'not a git repository' }),
        );

        const code = await run(['--real', '--exit-code']);

        expect(code).toBe(0);
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('legacy-method reports render the method line', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({
                branch: 'feat/current',
                clean: false,
                method: 'legacy',
                conflicts: [{ file: 'src/a.ts', kind: 'content' }],
            }),
        );

        await run(['--real']);

        expect(logged()).toContain('method: legacy');
    });
});
