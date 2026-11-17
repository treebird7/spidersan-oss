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
 *   - error report → printed, does not throw; exit 0 unflagged, 2 under --exit-code
 *   - --json → one document with status / errors / tested shas (sp-poga)
 *   - --base override is passed through to the analyzer
 *   - --real runs even when the registry is NOT initialized (single target)
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { analyzeRealConflicts } from '../src/lib/git-merge-analyzer';
import { getPRLabels } from '../src/lib/github';
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

vi.mock('../src/lib/github', () => ({
    isGhAvailable: vi.fn(() => true),
    getPRLabels: vi.fn(async () => []),
    getPRDetails: vi.fn(async () => ({ number: 0, title: '', headBranch: 'feat/x', files: [] })),
}));

vi.mock('../src/lib/carries', () => ({
    analyzeCarries: vi.fn(() => ({ own: [], inherited: [], flagged: false })),
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

const BASE_SHA = 'b'.repeat(40);
const HEAD_SHA = 'a'.repeat(40);

function makeReport(over: Partial<RealConflictReport> = {}): RealConflictReport {
    return {
        base: 'main',
        branch: 'feat/x',
        baseSha: BASE_SHA,
        headSha: HEAD_SHA,
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
        // getCurrentBranch() → execFileSync('git', ['rev-parse', ...]).
        // reconcile-on-read also probes `merge-base --is-ancestor`; throw there
        // so registered branches read as NOT merged (still in flight).
        (execFileSync as Mock).mockImplementation((_cmd: string, args?: string[]) => {
            if (Array.isArray(args) && args.includes('--is-ancestor')) {
                throw new Error('not an ancestor');
            }
            // resolveBranchRef() probes refs/remotes/<remote>/<trunk> first, so a
            // successful --verify here means "origin/main exists" — the normal
            // case, in which --real merges into the REMOTE trunk (sp-vifo).
            if (Array.isArray(args) && args.includes('--verify')) {
                return '';
            }
            return 'feat/current\n';
        });
    });

    it('clean current branch → exit 0 and prints "clean vs <base>"', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: true }),
        );

        const code = await run(['--real']);

        expect(code).toBe(0);
        expect(exitSpy).not.toHaveBeenCalled();
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'feat/current');
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
        // The JSON reports the ref actually merged into, not the branch name.
        expect(parsed.base).toBe('origin/main');
        expect(Array.isArray(parsed.results)).toBe(true);
        expect(parsed.results).toHaveLength(1);
        expect(parsed.results[0].branch).toBe('feat/current');
        expect(parsed.results[0].conflicts[0]).toEqual({ file: 'src/a.ts', kind: 'content' });
    });

    it('falls back to the LOCAL trunk when there is no origin/<trunk> (sp-vifo)', async () => {
        // No remote-tracking ref (fresh clone, no origin, detached mirror): every
        // --verify probe fails, so resolveBranchRef() returns null and the base
        // must degrade to the local branch name rather than an unresolvable ref.
        (execFileSync as Mock).mockImplementation((_cmd: string, args?: string[]) => {
            if (Array.isArray(args) && args.includes('--verify')) {
                throw new Error('fatal: Needed a single revision');
            }
            return 'feat/current\n';
        });
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: true }),
        );

        await run(['--real']);

        expect(analyzeRealConflicts).toHaveBeenCalledWith('main', 'feat/current');
    });

    it('never merges into a bare local trunk when origin/<trunk> exists (sp-vifo)', async () => {
        // The defect: a local trunk 78 commits behind origin merged cleanly, so
        // `--real` reported green against a base nobody is merging into.
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: true }),
        );

        await run(['--real']);

        expect(analyzeRealConflicts).not.toHaveBeenCalledWith('main', expect.anything());
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

        // Base resolution probes refs on disk, so "no git calls at all" is no
        // longer the guard — the guard is that the CURRENT branch is never read.
        expect(execFileSync).not.toHaveBeenCalledWith(
            'git', expect.arrayContaining(['--abbrev-ref']), expect.anything(),
        );
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'feat/other');
    });

    it('--pr fetches the PR head + remote trunk and checks the right pair (tb-57fr)', async () => {
        // Regression: --pr X --real used to ignore --pr and silently check
        // trunk-vs-trunk (current checkout) → false "clean". It must now resolve
        // the PR head ref AND compare against the REMOTE trunk, not stale local.
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'refs/spidersan/pr-81', clean: false, conflicts: [{ file: 'src/lib/colony-client.ts', kind: 'content' }] }),
        );

        const code = await run(['--real', '--pr', '81']);

        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'refs/spidersan/pr-81');
        // fetched PR head + the trunk (not just relied on a local ref)
        expect(execFileSync).toHaveBeenCalledWith('git', ['fetch', '--quiet', 'origin', '+pull/81/head:refs/spidersan/pr-81'], expect.anything());
        expect(execFileSync).toHaveBeenCalledWith('git', ['fetch', '--quiet', 'origin', 'main'], expect.anything());
        expect(code).toBe(0);
    });

    it('--pr rejects a non-numeric PR (no fetch, no analysis)', async () => {
        const code = await run(['--real', '--pr', 'abc']);
        expect(code).toBe(2); // nothing analysed: never the "conflict" code
        // Base resolution runs first and reads local refs; what must NOT happen
        // is a fetch or an analysis.
        expect(execFileSync).not.toHaveBeenCalledWith(
            'git', expect.arrayContaining(['fetch']), expect.anything(),
        );
        expect(analyzeRealConflicts).not.toHaveBeenCalled();
    });

    it('--pr --gate --exit-code blocks (exit 1) when a needs-* label is present', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({ branch: 'refs/spidersan/pr-80', clean: true }));
        (getPRLabels as Mock).mockResolvedValue(['needs-grant:memoak/URL', 'enhancement']);

        const code = await run(['--pr', '80', '--gate', '--exit-code']);

        expect(code).toBe(1); // clean merge, but precondition UNMET → blocked
        expect(logged()).toContain('precondition UNMET');
        expect(logged()).toContain('needs-grant:memoak/URL');
    });

    it('--pr --gate passes (exit 0) when no needs-* label', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({ branch: 'refs/spidersan/pr-80', clean: true }));
        (getPRLabels as Mock).mockResolvedValue(['enhancement']);

        const code = await run(['--pr', '80', '--gate', '--exit-code']);

        expect(code).toBe(0);
        expect(logged()).toContain('no unmet needs-* gate');
    });

    it('--pr defaults to the real merge-tree path (no --real flag needed)', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({ branch: 'refs/spidersan/pr-81', clean: true }));

        await run(['--pr', '81']); // note: no --real
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'refs/spidersan/pr-81');
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
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'feat/a');
        expect(analyzeRealConflicts).toHaveBeenCalledWith('origin/main', 'feat/c');
        expect(analyzeRealConflicts).not.toHaveBeenCalledWith('origin/main', 'feat/b');
    });

    it('--all exits 1 when the registry is not initialized', async () => {
        const mockStorage = {
            isInitialized: vi.fn().mockResolvedValue(false),
            list: vi.fn(),
        };
        (getStorage as Mock).mockResolvedValue(mockStorage);

        const code = await run(['--real', '--all']);

        expect(code).toBe(2);
        expect(exitSpy).toHaveBeenCalledWith(2);
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

    it('--exit-code exits 2 on an analysis error — not 0, and not the conflict code (sp-poga)', async () => {
        (analyzeRealConflicts as Mock).mockResolvedValue(
            makeReport({ branch: 'feat/current', clean: false, error: 'not a git repository' }),
        );

        expect(await run(['--real', '--exit-code'])).toBe(2);
        expect(await run(['--real', '--strict'])).toBe(2);
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

    // ── sp-poga: --json is a contract a script can fail closed on ────────────
    describe('--json contract (sp-poga)', () => {
        /** The single JSON document on stdout. JSON.parse throws if there is more than one. */
        const doc = () => JSON.parse(logged());
        const originUrl = (url: string) => {
            (execFileSync as Mock).mockImplementation((_cmd: string, args?: string[]) => {
                if (Array.isArray(args) && args.includes('get-url')) return `${url}\n`;
                if (Array.isArray(args) && args.includes('--verify')) return '';
                return 'feat/current\n';
            });
        };

        it('clean PR → status clean, full head/base shas, pr and repo; exit 0', async () => {
            originUrl('git@github.com:acme/widgets.git');
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({ base: 'origin/main', branch: 'refs/spidersan/pr-81' }));

            const code = await run(['--pr', '81', '--real', '--json', '--exit-code']);

            expect(code).toBe(0);
            const out = doc();
            expect(out).toMatchObject({ status: 'clean', pr: 81, repo: 'acme/widgets', base: 'origin/main', errors: [] });
            expect(out.results).toHaveLength(1);
            expect(out.results[0].headSha).toBe(HEAD_SHA);
            expect(out.results[0].baseSha).toBe(BASE_SHA);
            expect(out.results[0].headSha).toMatch(/^[0-9a-f]{40}$/);
            expect(out.results[0].clean).toBe(true); // pre-existing field kept
        });

        it('repo is parsed from an https origin too, and is null when there is none', async () => {
            originUrl('https://github.com/acme/widgets');
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport());
            await run(['--real', '--json']);
            expect(doc().repo).toBe('acme/widgets');

            logSpy.mockClear();
            originUrl('');
            await run(['--real', '--json']);
            expect(doc()).toMatchObject({ repo: null, pr: null, status: 'clean' });
        });

        it('conflict → status conflict, exit 1 under --exit-code', async () => {
            (analyzeRealConflicts as Mock).mockResolvedValue(
                makeReport({ clean: false, conflicts: [{ file: 'src/a.ts', kind: 'content' }] }),
            );

            const code = await run(['--pr', '81', '--json', '--exit-code']);

            expect(code).toBe(1);
            expect(doc()).toMatchObject({ status: 'conflict', errors: [] });
            expect(doc().results[0].conflicts).toEqual([{ file: 'src/a.ts', kind: 'content' }]);
        });

        it('analyzer error → status error, listed in errors, exit 2 under --exit-code', async () => {
            (analyzeRealConflicts as Mock).mockResolvedValue(
                makeReport({ branch: 'refs/spidersan/pr-81', clean: false, headSha: null, error: 'ref not found: refs/spidersan/pr-81' }),
            );

            const code = await run(['--pr', '81', '--json', '--exit-code']);

            expect(code).toBe(2);
            const out = doc();
            expect(out.status).toBe('error');
            expect(out.errors).toEqual([{ stage: 'analysis', ref: 'refs/spidersan/pr-81', message: 'ref not found: refs/spidersan/pr-81' }]);
        });

        it('analyzer error without --exit-code keeps exit 0 but the JSON still says error', async () => {
            // The MCP server calls `conflicts --real --json` unflagged and reads the document.
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({ clean: false, error: 'merge-tree failed' }));

            const code = await run(['--real', '--json']);

            expect(code).toBe(0);
            expect(doc().status).toBe('error');
        });

        it('fetch failure → still one JSON document with status error; exit 2 even unflagged', async () => {
            (execFileSync as Mock).mockImplementation((_cmd: string, args?: string[]) => {
                if (Array.isArray(args) && args.includes('fetch')) throw new Error("couldn't find remote ref pull/999/head");
                return '';
            });

            const code = await run(['--pr', '999', '--json']);

            expect(code).toBe(2);
            expect(analyzeRealConflicts).not.toHaveBeenCalled();
            const out = doc();
            expect(out).toMatchObject({ status: 'error', pr: 999, results: [] });
            expect(out.errors[0].stage).toBe('fetch');
            expect(out.errors[0].message).toContain('pull/999/head');
        });

        it.each(['', '42junk', '42.5', '0', '-3'])('--pr "%s" is not a PR number: status error, exit 2, nothing fetched', async (raw) => {
            const code = await run(['--pr', raw, '--real', '--json', '--exit-code']);

            expect(code).toBe(2);
            expect(doc()).toMatchObject({ status: 'error', pr: null, results: [], errors: [{ stage: 'usage' }] });
            expect(execFileSync).not.toHaveBeenCalledWith('git', expect.arrayContaining(['fetch']), expect.anything());
            expect(analyzeRealConflicts).not.toHaveBeenCalled();
        });

        it.each([
            ['--gate without --pr', ['--real', '--gate']],
            ['--carries without --pr', ['--real', '--carries']],
            ['an empty --branch', ['--real', '--branch', '']],
            ['an empty --base', ['--real', '--base', '']],
        ])('%s is a usage error, not a check of the current checkout', async (_name, args) => {
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport());

            const code = await run([...args, '--json', '--exit-code']);

            expect(code).toBe(2);
            expect(doc()).toMatchObject({ status: 'error', results: [], errors: [{ stage: 'usage' }] });
            expect(analyzeRealConflicts).not.toHaveBeenCalled();
        });

        it('a legacy-method result the analyzer could not verify is status error, never clean', async () => {
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({
                method: 'legacy', clean: false,
                error: 'legacy merge-tree found no conflict but cannot verify modify/delete or rename; needs git >= 2.38',
            }));

            const code = await run(['--pr', '81', '--json', '--exit-code']);

            expect(code).toBe(2);
            expect(doc().status).not.toBe('clean');
            expect(doc().status).toBe('error');
        });

        it('a "clean" report that names no shas is an error, not clean', async () => {
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport({ headSha: null }));

            const code = await run(['--real', '--json', '--exit-code']);

            expect(code).toBe(2);
            expect(doc().status).toBe('error');
        });

        it('an error outranks a conflict (--all): status error, exit 2', async () => {
            (getStorage as Mock).mockResolvedValue({
                isInitialized: vi.fn().mockResolvedValue(true),
                list: vi.fn().mockResolvedValue([
                    { name: 'feat/a', status: 'active', files: [] },
                    { name: 'feat/b', status: 'active', files: [] },
                ]),
            });
            (analyzeRealConflicts as Mock).mockImplementation(async (_base: string, branch: string) =>
                branch === 'feat/a'
                    ? makeReport({ branch, clean: false, conflicts: [{ file: 'x', kind: 'content' }] })
                    : makeReport({ branch, clean: false, error: 'ref not found: feat/b' }));

            const code = await run(['--real', '--all', '--json', '--exit-code']);

            expect(code).toBe(2);
            expect(doc().status).toBe('error');
        });

        it('--all with nothing to analyse → status incomplete, never clean', async () => {
            (getStorage as Mock).mockResolvedValue({
                isInitialized: vi.fn().mockResolvedValue(true),
                list: vi.fn().mockResolvedValue([]),
            });

            const code = await run(['--real', '--all', '--json', '--exit-code']);

            expect(code).toBe(0);
            expect(doc()).toMatchObject({ status: 'incomplete', results: [] });
        });

        it('--gate: an unmet label is blocked (exit 1); unreadable labels are an error (exit 2)', async () => {
            (analyzeRealConflicts as Mock).mockResolvedValue(makeReport());
            (getPRLabels as Mock).mockResolvedValue(['needs-grant:x']);
            expect(await run(['--pr', '80', '--gate', '--json', '--exit-code'])).toBe(1);
            expect(doc().status).toBe('blocked');

            logSpy.mockClear();
            (getPRLabels as Mock).mockResolvedValue(null);
            expect(await run(['--pr', '80', '--gate', '--json', '--exit-code'])).toBe(2);
            expect(doc()).toMatchObject({ status: 'error', errors: [{ stage: 'gate' }] });
        });
    });
});
