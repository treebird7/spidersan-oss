import { describe, expect, test } from 'bun:test';
import { GitHub, PAGE, ciObservations, parseBranchTip, parseFiles, parseGate, parseInventory, parsePr } from './github';
import { classifyTouches, readCi } from './readers';
import type { CommandResult } from './readers';

// Payload shapes are the fields of real responses from treebird7/spidersan-oss (2026-11-18).
const sha = (c: string): string => c.repeat(40);
const HEAD = sha('a');
const BASE = sha('b');
const MERGE = sha('c');
const REPO = 'owner/name';
const ACTIONS = 15368;

const json = (value: unknown): string => JSON.stringify(value);

function listed(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        number: 7,
        state: 'open',
        draft: false,
        head: { sha: HEAD, repo: { full_name: REPO } },
        base: { ref: 'main', sha: BASE, repo: { full_name: REPO } },
        ...over,
    };
}

function pull(over: Record<string, unknown> = {}): Record<string, unknown> {
    return { ...listed(), merged: false, merge_commit_sha: null, changed_files: 2, ...over };
}

const run = (name: string, conclusion: string | null, over: Record<string, unknown> = {}) => ({
    name,
    head_sha: HEAD,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    app: { id: ACTIONS },
    ...over,
});
const runs = (list: unknown[], total: number = list.length) => json({ total_count: total, check_runs: list });
const statuses = (list: { context: string; state: string }[], over: Record<string, unknown> = {}) =>
    json({ sha: HEAD, state: 'pending', total_count: list.length, statuses: list, ...over });

describe('parseInventory', () => {
    test('lists open PRs', () => {
        expect(parseInventory(json([listed(), listed({ number: 8, draft: true })]), REPO)).toEqual({
            complete: true,
            prs: [
                { number: 7, draft: false, fork: false, head: HEAD, baseRef: 'main' },
                { number: 8, draft: true, fork: false, head: HEAD, baseRef: 'main' },
            ],
        });
    });

    test('no open PRs is a complete, empty listing', () => {
        expect(parseInventory('[]', REPO)).toEqual({ complete: true, prs: [] });
    });

    test('a head in another repo, or in a deleted one, is a fork', () => {
        const other = listed({ head: { sha: HEAD, repo: { full_name: 'someone/name' } } });
        const gone = listed({ number: 8, head: { sha: HEAD, repo: null } });
        expect(parseInventory(json([other, gone]), REPO).prs.map((pr) => pr.fork)).toEqual([true, true]);
    });

    test('a full page is reported as incomplete', () => {
        const page = Array.from({ length: PAGE }, (_, i) => listed({ number: i + 1 }));
        const inventory = parseInventory(json(page), REPO);
        expect(inventory.complete).toBe(false);
        expect(inventory.prs).toHaveLength(PAGE);
        expect(parseInventory(json(page.slice(1)), REPO).complete).toBe(true);
    });

    test.each([
        ['not JSON', 'gh: Not Found'],
        ['an object', '{}'],
        ['no output', undefined],
    ])('%s: incomplete and empty', (_name, stdout) => {
        expect(parseInventory(stdout, REPO)).toEqual({ complete: false, prs: [] });
    });

    test.each([
        ['an abbreviated head', listed({ head: { sha: 'abc1234', repo: { full_name: REPO } } })],
        ['a base in another repo', listed({ base: { ref: 'main', repo: { full_name: 'x/y' } } })],
        ['a closed entry', listed({ state: 'closed' })],
        ['no draft flag', listed({ draft: undefined })],
        ['a base ref starting with a dash', listed({ base: { ref: '-x', repo: { full_name: REPO } } })],
        ['a string', 'nope'],
    ])('an entry with %s is dropped and marks the listing incomplete', (_name, bad) => {
        const inventory = parseInventory(json([listed({ number: 8 }), bad]), REPO);
        expect(inventory.complete).toBe(false);
        expect(inventory.prs.map((pr) => pr.number)).toEqual([8]);
    });

    test('a repeated PR number: incomplete and empty', () => {
        expect(parseInventory(json([listed(), listed()]), REPO)).toEqual({ complete: false, prs: [] });
    });
});

describe('parsePr', () => {
    const ref = { repo: REPO, pr: 7 };

    test('open', () => {
        expect(parsePr(json(pull()), ref)).toEqual({ kind: 'open', head: HEAD, baseRef: 'main', changedFiles: 2 });
    });

    test('merged: the head that was merged and the merge commit', () => {
        const merged = pull({ state: 'closed', merged: true, merge_commit_sha: MERGE });
        expect(parsePr(json(merged), ref)).toEqual({ kind: 'merged', head: HEAD, mergeCommit: MERGE });
    });

    test('closed without merging', () => {
        // GitHub leaves a test-merge sha in merge_commit_sha on some closed PRs: `merged` decides.
        expect(parsePr(json(pull({ state: 'closed', merge_commit_sha: MERGE })), ref)).toEqual({ kind: 'closed' });
    });

    test.each([
        ['a 404 body', json({ message: 'Not Found', status: '404' })],
        ['another PR number', json(pull({ number: 8 }))],
        ['another repo', json(pull({ base: { ref: 'main', repo: { full_name: 'x/y' } } }))],
        ['an abbreviated head', json(pull({ head: { sha: 'abc1234' } }))],
        ['open but merged', json(pull({ merged: true }))],
        ['merged with no merge commit', json(pull({ state: 'closed', merged: true }))],
        ['an unknown state', json(pull({ state: 'locked' }))],
        ['no merged flag', json(pull({ merged: undefined }))],
        ['no file count', json(pull({ changed_files: undefined }))],
        ['no output', undefined],
    ])('%s is unknown', (_name, stdout) => {
        expect(parsePr(stdout, ref)).toEqual({ kind: 'unknown' });
    });
});

describe('parseBranchTip', () => {
    const tip = (over: Record<string, unknown> = {}) =>
        json({ ref: 'refs/heads/main', object: { type: 'commit', sha: BASE }, ...over });

    test('the tip of the branch asked for', () => {
        expect(parseBranchTip(tip(), 'main')).toBe(BASE);
    });

    test.each([
        ['another ref (a prefix match lists several)', tip({ ref: 'refs/heads/main-2' })],
        ['an array of refs', json([JSON.parse(tip())])],
        ['a tag object', tip({ object: { type: 'tag', sha: BASE } })],
        ['a short sha', tip({ object: { type: 'commit', sha: 'abc' } })],
        ['no output', undefined],
    ])('%s is null', (_name, stdout) => {
        expect(parseBranchTip(stdout, 'main')).toBeNull();
    });
});

describe('ciObservations → readCi', () => {
    const required = [{ context: 'build', appId: ACTIONS }];
    const judge = (checkRuns: unknown, status: unknown = statuses([])) => {
        const input = ciObservations(checkRuns, status, HEAD);
        return input && readCi({ ...input, required, gateContext: 'gate', gateAppId: null, testedMerge: null });
    };
    const verdict = (complete: boolean, green: boolean) => ({ headSha: HEAD, complete, green, testedBase: null });

    test('all runs succeeded: complete and green', () => {
        expect(judge(runs([run('build', 'success'), run('lint', 'skipped')]))).toEqual(verdict(true, true));
    });

    test('a failed run that is not required: complete, not green', () => {
        expect(judge(runs([run('build', 'success'), run('audit', 'failure')]))).toEqual(verdict(true, false));
    });

    test('a run still in progress: not complete', () => {
        expect(judge(runs([run('build', 'success'), run('slow', null)]))).toEqual(verdict(false, false));
    });

    test.each(['cancelled', 'timed_out', 'action_required', 'stale'])('a %s run: no verdict', (conclusion) => {
        expect(judge(runs([run('build', 'success'), run('other', conclusion)]))).toEqual(verdict(false, false));
    });

    test('the required run from another app does not count', () => {
        expect(judge(runs([run('build', 'success', { app: { id: 1 } })]))).toEqual(verdict(false, false));
    });

    test('commit statuses are judged too, and carry no app id', () => {
        const input = ciObservations(
            runs([run('build', 'success')]),
            statuses([{ context: 'ci/x', state: 'failure' }]),
            HEAD,
        );
        expect(input?.observations).toEqual([
            { context: 'build', appId: ACTIONS, headSha: HEAD, state: 'success' },
            { context: 'ci/x', appId: null, headSha: HEAD, state: 'failure' },
        ]);
        expect(input?.expectedCount).toBe(2);
        expect(judge(runs([run('build', 'success')]), statuses([{ context: 'ci/x', state: 'failure' }]))).toEqual(
            verdict(true, false),
        );
    });

    test('the coordinator gate status is left out of the verdict', () => {
        expect(judge(runs([run('build', 'success')]), statuses([{ context: 'gate', state: 'pending' }]))).toEqual(
            verdict(true, true),
        );
    });

    test('more runs than the page holds: not complete', () => {
        expect(judge(runs([run('build', 'success')], 2))).toEqual(verdict(false, false));
        const page = Array.from({ length: PAGE }, (_, i) => run(`job ${i}`, 'success'));
        expect(judge(runs([run('build', 'success'), ...page.slice(1)]))).toEqual(verdict(false, false));
    });

    test('a run on another commit: no evidence at all', () => {
        expect(judge(runs([run('build', 'success', { head_sha: BASE })]))).toBeNull();
    });

    test.each([
        ['check runs not JSON', 'nope', statuses([])],
        ['no check_runs list', json({ total_count: 0 }), statuses([])],
        ['no total_count', json({ check_runs: [] }), statuses([])],
        ['a run with no app', runs([run('build', 'success', { app: null })]), statuses([])],
        ['a completed run with no conclusion', runs([run('build', 'success', { conclusion: null })]), statuses([])],
        ['statuses for another commit', runs([]), statuses([], { sha: BASE })],
        ['a truncated status list', runs([]), statuses([], { total_count: 3 })],
        ['a status with no state', runs([]), json({ sha: HEAD, total_count: 1, statuses: [{ context: 'x' }] })],
        ['statuses missing', runs([]), undefined],
    ])('%s: null', (_name, checkRuns, status) => {
        expect(ciObservations(checkRuns, status, HEAD)).toBeNull();
    });

    test('a head that is not a full sha: null', () => {
        expect(ciObservations(runs([]), statuses([]), 'abc1234')).toBeNull();
    });
});

describe('parseGate', () => {
    test('success', () => {
        expect(parseGate(statuses([{ context: 'gate', state: 'success' }]), HEAD, 'gate')).toEqual({ kind: 'success' });
    });

    test.each([
        ['pending', [{ context: 'gate', state: 'pending' }]],
        ['failure', [{ context: 'gate', state: 'failure' }]],
        ['absent', [{ context: 'other', state: 'success' }]],
    ])('%s is clear', (_name, list) => {
        expect(parseGate(statuses(list), HEAD, 'gate')).toEqual({ kind: 'clear' });
    });

    test.each([
        ['another commit', statuses([{ context: 'gate', state: 'pending' }], { sha: BASE })],
        ['a truncated list', statuses([{ context: 'other', state: 'success' }], { total_count: 2 })],
        [
            'the gate listed twice',
            statuses([
                { context: 'gate', state: 'pending' },
                { context: 'gate', state: 'success' },
            ]),
        ],
        ['no output', undefined],
    ])('%s is unknown', (_name, stdout) => {
        expect(parseGate(stdout, HEAD, 'gate')).toEqual({ kind: 'unknown' });
    });
});

describe('parseFiles → classifyTouches', () => {
    const patterns = { protectedPaths: ['coordinator/'], mergeEffects: ['supabase/'] };
    const touches = (stdout: unknown, changed: number) => classifyTouches(parseFiles(stdout, HEAD, changed), patterns);
    const CLOSED = { headSha: HEAD, protectedPaths: true, mergeEffects: true };

    test('plain files', () => {
        const list = json([{ filename: 'src/a.ts' }, { filename: 'README.md' }]);
        expect(touches(list, 2)).toEqual({ headSha: HEAD, protectedPaths: false, mergeEffects: false });
    });

    test('a rename out of a protected directory still touches it', () => {
        const list = json([{ filename: 'src/main.ts', previous_filename: 'coordinator/main.ts' }]);
        expect(touches(list, 1)).toEqual({ headSha: HEAD, protectedPaths: true, mergeEffects: false });
    });

    test.each([
        ['fewer entries than the PR changed', json([{ filename: 'src/a.ts' }]), 2],
        ['a full page', json(Array.from({ length: PAGE }, (_, i) => ({ filename: `src/${i}.ts` }))), PAGE],
        ['an entry with no filename', json([{ sha: 'x' }]), 1],
        ['a non-string previous name', json([{ filename: 'src/a.ts', previous_filename: 3 }]), 1],
        ['not JSON', 'nope', 1],
        ['no output', undefined, 1],
    ])('%s fails closed', (_name, stdout, changed) => {
        expect(touches(stdout, changed)).toEqual(CLOSED);
    });
});

describe('GitHub', () => {
    /** A runner that answers `gh api <path>` from a table and records every call. */
    function scripted(table: Record<string, string | (() => string)>) {
        const calls: string[][] = [];
        const runner = (command: string, argv: readonly string[]): CommandResult => {
            calls.push([command, ...argv]);
            const answer = table[argv[1] ?? ''];
            if (answer === undefined) return { exitCode: 1, stdout: json({ message: 'Not Found' }) };
            return { exitCode: 0, stdout: typeof answer === 'function' ? answer() : answer };
        };
        return { github: new GitHub(runner), calls };
    }
    const ref = { repo: REPO, pr: 7 };
    const tip = json({ ref: 'refs/heads/main', object: { type: 'commit', sha: BASE } });

    test('readPr: an open PR is read with the tip of its base branch', async () => {
        const { github, calls } = scripted({
            'repos/owner/name/pulls/7': json(pull()),
            'repos/owner/name/git/ref/heads/main': tip,
        });
        expect(await github.readPr(ref)).toEqual({ kind: 'open', head: HEAD, base: BASE });
        expect(calls).toEqual([
            ['gh', 'api', 'repos/owner/name/pulls/7'],
            ['gh', 'api', 'repos/owner/name/git/ref/heads/main'],
        ]);
    });

    test('readPr: open with an unreadable base tip is unknown', async () => {
        const { github } = scripted({ 'repos/owner/name/pulls/7': json(pull()) });
        expect(await github.readPr(ref)).toEqual({ kind: 'unknown' });
    });

    test('readPr: merged needs no second call', async () => {
        const merged = json(pull({ state: 'closed', merged: true, merge_commit_sha: MERGE }));
        const { github, calls } = scripted({ 'repos/owner/name/pulls/7': merged });
        expect(await github.readPr(ref)).toEqual({ kind: 'merged', head: HEAD, mergeCommit: MERGE });
        expect(calls).toHaveLength(1);
    });

    test('a failed command, or a runner that throws, is unknown', async () => {
        expect(await scripted({}).github.readPr(ref)).toEqual({ kind: 'unknown' });
        const throwing = new GitHub(() => {
            throw new Error('spawn failed');
        });
        expect(await throwing.readPr(ref)).toEqual({ kind: 'unknown' });
        expect(await throwing.inventory(REPO)).toEqual({ complete: false, prs: [] });
        expect(await throwing.ci(REPO, HEAD)).toBeNull();
        expect(await throwing.gate({ repo: REPO, head: HEAD }, 'gate')).toEqual({ kind: 'unknown' });
    });

    test('a non-zero exit is not read, whatever it printed', async () => {
        const merged = json(pull({ state: 'closed', merged: true, merge_commit_sha: MERGE }));
        expect(await new GitHub(() => ({ exitCode: 1, stdout: merged })).readPr(ref)).toEqual({ kind: 'unknown' });
        expect(await new GitHub(() => ({ exitCode: null, stdout: merged })).readPr(ref)).toEqual({ kind: 'unknown' });
    });

    test.each([
        ['a repo with a path in it', { repo: 'owner/name/../x', pr: 7 }],
        ['a repo with a query', { repo: 'owner/name?x=1', pr: 7 }],
        ['a fractional PR number', { repo: REPO, pr: 1.5 }],
        ['a zero PR number', { repo: REPO, pr: 0 }],
    ])('%s: nothing is run', async (_name, bad) => {
        const { github, calls } = scripted({});
        expect(await github.readPr(bad)).toEqual({ kind: 'unknown' });
        expect(await github.files(bad)).toBeNull();
        if (bad.repo !== REPO) expect(await github.inventory(bad.repo)).toEqual({ complete: false, prs: [] });
        expect(calls).toEqual([]);
    });

    test('ci and gate refuse a head that is not a full sha without running anything', async () => {
        const { github, calls } = scripted({});
        expect(await github.ci(REPO, 'main')).toBeNull();
        expect(await github.gate({ repo: REPO, head: 'main' }, 'gate')).toEqual({ kind: 'unknown' });
        expect(await github.gate({ repo: REPO, head: HEAD }, '')).toEqual({ kind: 'unknown' });
        expect(calls).toEqual([]);
    });

    test('inventory, ci and gate ask for one full page', async () => {
        const { github, calls } = scripted({
            'repos/owner/name/pulls?state=open&per_page=100': json([listed()]),
            [`repos/owner/name/commits/${HEAD}/check-runs?per_page=100`]: runs([run('build', 'success')]),
            [`repos/owner/name/commits/${HEAD}/status?per_page=100`]: statuses([{ context: 'gate', state: 'success' }]),
        });
        expect((await github.inventory(REPO)).prs).toHaveLength(1);
        expect((await github.ci(REPO, HEAD))?.expectedCount).toBe(2);
        expect(await github.gate({ repo: REPO, head: HEAD }, 'gate')).toEqual({ kind: 'success' });
        expect(calls).toHaveLength(4);
    });

    test('files: the listing of an open PR, stamped with its head', async () => {
        const { github } = scripted({
            'repos/owner/name/pulls/7': json(pull()),
            'repos/owner/name/pulls/7/files?per_page=100': json([{ filename: 'a' }, { filename: 'b' }]),
        });
        expect(await github.files(ref)).toEqual({ headSha: HEAD, files: ['a', 'b'], expectedCount: 2 });
    });

    test('files: a push between the two reads of the PR fails closed', async () => {
        const heads = [HEAD, MERGE];
        const { github } = scripted({
            'repos/owner/name/pulls/7': () => json(pull({ head: { sha: heads.shift(), repo: { full_name: REPO } } })),
            'repos/owner/name/pulls/7/files?per_page=100': json([{ filename: 'a' }, { filename: 'b' }]),
        });
        expect(await github.files(ref)).toEqual({ headSha: HEAD, files: null, expectedCount: -1 });
    });

    test('files: a PR that is not open has none', async () => {
        const { github } = scripted({ 'repos/owner/name/pulls/7': json(pull({ state: 'closed' })) });
        expect(await github.files(ref)).toBeNull();
    });
});
