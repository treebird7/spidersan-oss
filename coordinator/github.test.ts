import { describe, expect, test } from 'bun:test';
import {
    ACTIONS_APP_ID,
    GitHub,
    MAX_PAGES,
    PAGE,
    ciObservations,
    parseBranchTip,
    parseFiles,
    parseGate,
    parseInventory,
    parsePr,
} from './github';
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

// Real responses, trimmed to the fields read (plus `name` and `event`), 2026-11-20:
// treebird7/spidersan-oss #360 at its head, and a partial re-run in treebird7/Envoak.
const REAL_HEAD = 'f9c69f4bad6c1ff204322d07df819f7a376f830d';
const REAL_RUNS = {
    total_count: 2,
    workflow_runs: [
        {
            id: 44531811903,
            name: 'CI',
            head_sha: REAL_HEAD,
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
            event: 'pull_request',
        },
        {
            id: 44531800887,
            name: 'ts-review',
            head_sha: REAL_HEAD,
            status: 'completed',
            conclusion: 'success',
            run_attempt: 1,
            event: 'push',
        },
    ],
};
const realJob = (id: number, runId: number, name: string) => ({
    id,
    run_id: runId,
    run_attempt: 1,
    name,
    head_sha: REAL_HEAD,
    status: 'completed',
    conclusion: 'success',
});
const REAL_CI_JOBS = {
    total_count: 8,
    jobs: [
        realJob(135586787441, 44531811903, 'Plugin hook suites'),
        realJob(135586787562, 44531811903, 'coordinator typecheck · bun test'),
        realJob(135586787565, 44531811903, 'build (24)'),
        realJob(135586787642, 44531811903, 'mcp-server build · test · audit'),
        realJob(135586787659, 44531811903, 'Dependency and secret scan'),
        realJob(135586787676, 44531811903, 'ts-review detect step'),
        realJob(135586788163, 44531811903, 'build (22)'),
        realJob(135587234808, 44531811903, 'test-cli'),
    ],
};
const REAL_REVIEW_JOBS = { total_count: 1, jobs: [realJob(135586754030, 44531800887, 'ts-review')] };
const NO_STATUSES = json({ sha: REAL_HEAD, state: 'pending', total_count: 0, statuses: [] });
/** spidersan-oss main's ruleset, 2026-11-20 (no app named: the Actions app reports all three). */
const REAL_REQUIRED = ['build (22)', 'build (24)', 'test-cli'].map((context) => ({ context, appId: ACTIONS }));

/** treebird7/Envoak run 43420197808, `jobs?filter=all`: attempt 2 re-ran the failed job and carried the rest over. */
const RERUN_HEAD = 'e80e1c8e6e09fb5443feb3decc72b0a75811f897';
const RERUN_ID = 43420197808;
const rerunJob = (id: number, attempt: number, name: string, conclusion: string) => ({
    id,
    run_id: RERUN_ID,
    run_attempt: attempt,
    name,
    head_sha: RERUN_HEAD,
    status: 'completed',
    conclusion,
});
const RERUN_JOBS = [
    rerunJob(131867985864, 1, 'macOS · Touch ID helper watchdog', 'success'),
    rerunJob(131867986283, 1, 'typecheck · build · test', 'failure'),
    rerunJob(131867986306, 1, 'Dependency and secret scan', 'success'),
    rerunJob(131867988670, 1, 'typecheck · build · test · node 26', 'skipped'),
    rerunJob(131881242377, 2, 'typecheck · build · test', 'cancelled'),
    rerunJob(131881244424, 2, 'macOS · Touch ID helper watchdog', 'success'),
    rerunJob(131881294611, 2, 'Dependency and secret scan', 'success'),
    rerunJob(131881294828, 2, 'typecheck · build · test · node 26', 'skipped'),
];
const RERUN_RUN = {
    id: RERUN_ID,
    name: 'CI',
    head_sha: RERUN_HEAD,
    status: 'completed',
    conclusion: 'cancelled',
    run_attempt: 2,
};

/** A workflow run on HEAD, completed. */
const wfRun = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    name: 'CI',
    head_sha: HEAD,
    status: 'completed',
    conclusion: 'success',
    run_attempt: 1,
    ...over,
});
/** A job of run 11 on HEAD, first attempt; a null conclusion is a job still running. */
const wfJob = (name: string, conclusion: string | null, over: Record<string, unknown> = {}) => ({
    id: 1,
    run_id: 11,
    run_attempt: 1,
    name,
    head_sha: HEAD,
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    ...over,
});
const statuses = (list: { context: string; state: string }[], over: Record<string, unknown> = {}) =>
    json({ sha: HEAD, state: 'pending', total_count: list.length, statuses: list, ...over });

describe('parseInventory', () => {
    test('lists open PRs', () => {
        expect(parseInventory(json([listed(), listed({ number: 8, draft: true })]), REPO)).toEqual({
            complete: true,
            prs: [
                { number: 7, draft: false, fork: false, head: HEAD, baseRef: 'main', title: '' },
                { number: 8, draft: true, fork: false, head: HEAD, baseRef: 'main', title: '' },
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

describe('ciObservations → readCi (sp-cabo)', () => {
    const required = [{ context: 'build', appId: ACTIONS }];
    const RUN = 11;
    const judge = (runList: unknown[], jobList: unknown[], status: unknown = statuses([]), req = required) => {
        const input = ciObservations(runList, jobList, status, HEAD);
        return input && readCi({ ...input, required: req, gateContext: 'gate', gateAppId: null, testedMerge: null });
    };
    const verdict = (complete: boolean, green: boolean, head = HEAD) => ({
        headSha: head,
        complete,
        green,
        testedBase: null,
    });
    const one = [wfRun(RUN)];

    test('shape of a real actions/runs + jobs listing, spidersan-oss #360 head, 2026-11-20', () => {
        const jobs = [...REAL_CI_JOBS.jobs, ...REAL_REVIEW_JOBS.jobs];
        const input = ciObservations(REAL_RUNS.workflow_runs, jobs, NO_STATUSES, REAL_HEAD);
        expect(input?.expectedCount).toBe(9);
        expect(input?.observations).toContainEqual({
            context: 'build (22)',
            appId: ACTIONS,
            headSha: REAL_HEAD,
            state: 'success',
        });
        const settings = { required: REAL_REQUIRED, gateContext: null, gateAppId: null, testedMerge: null };
        const ci = input && readCi({ ...input, ...settings });
        expect(ci).toEqual(verdict(true, true, REAL_HEAD));
    });

    test('shape of a real partial re-run (jobs?filter=all), Envoak, 2026-11-20: only attempt 2 counts', () => {
        const none = json({ sha: RERUN_HEAD, total_count: 0, statuses: [] });
        const input = ciObservations([RERUN_RUN], RERUN_JOBS, none, RERUN_HEAD);
        expect(input?.observations).toHaveLength(4);
        expect(input?.observations).toContainEqual({
            context: 'typecheck · build · test',
            appId: ACTIONS,
            headSha: RERUN_HEAD,
            state: 'cancelled',
        });
        expect(input?.observations).not.toContainEqual(expect.objectContaining({ state: 'failure' }));
    });

    test('a failure an attempt superseded is not read again: green', () => {
        const jobs = [
            wfJob('build', 'failure', { run_attempt: 1 }),
            wfJob('build', 'success', { id: 2, run_attempt: 2 }),
        ];
        expect(judge([wfRun(RUN, { run_attempt: 2 })], jobs)).toEqual(verdict(true, true));
    });

    test('a success an attempt superseded does not count: red', () => {
        const jobs = [
            wfJob('build', 'success', { run_attempt: 2 }),
            wfJob('build', 'failure', { id: 2, run_attempt: 3 }),
        ];
        expect(judge([wfRun(RUN, { run_attempt: 3 })], jobs)).toEqual(verdict(true, false));
    });

    test('a re-run cancelled before any job started: the run is cancelled, attempt 1 green is history (#361)', () => {
        const run = wfRun(RUN, { run_attempt: 2, conclusion: 'cancelled' });
        const input = ciObservations([run], [wfJob('build', 'success')], statuses([]), HEAD);
        expect(input?.observations).toEqual([
            { context: `actions run ${RUN}`, appId: null, headSha: HEAD, state: 'cancelled' },
        ]);
        expect(judge([run], [wfJob('build', 'success')])).toEqual(verdict(false, false));
    });

    test('a job a re-run dropped keeps no stale green: a required job only attempt 1 has is no verdict', () => {
        const jobs = [wfJob('lint', 'success'), wfJob('build', 'success', { id: 2, run_attempt: 2 })];
        const req = [...required, { context: 'lint', appId: ACTIONS }];
        expect(judge([wfRun(RUN, { run_attempt: 2 })], jobs, statuses([]), req)).toEqual(verdict(false, false));
    });

    test('nor a stale red: only the current attempt is judged', () => {
        const jobs = [wfJob('audit', 'failure'), wfJob('build', 'success', { id: 2, run_attempt: 2 })];
        expect(judge([wfRun(RUN, { run_attempt: 2 })], jobs)).toEqual(verdict(true, true));
    });

    test('a job of an attempt newer than the run says (the runs listing is older): null', () => {
        const jobs = [wfJob('build', 'success', { run_attempt: 2 })];
        expect(ciObservations([wfRun(RUN)], jobs, statuses([]), HEAD)).toBeNull();
    });

    test('the attempt number decides, not the order GitHub lists jobs in', () => {
        const jobs = [
            wfJob('build', 'success', { id: 2, run_attempt: 2 }),
            wfJob('build', 'failure', { run_attempt: 1 }),
        ];
        expect(judge([wfRun(RUN, { run_attempt: 2 })], jobs)).toEqual(verdict(true, true));
    });

    test('two jobs of one name in the same attempt both count: disagreeing, no verdict', () => {
        const jobs = [wfJob('build', 'success'), wfJob('build', 'failure', { id: 2 })];
        expect(judge(one, jobs)).toEqual(verdict(false, false));
    });

    test('an attempt of one run does not supersede a job of another run', () => {
        const jobs = [wfJob('build', 'failure'), wfJob('build', 'success', { id: 2, run_id: 12, run_attempt: 2 })];
        expect(judge([...one, wfRun(12, { run_attempt: 2 })], jobs)).toEqual(verdict(false, false));
    });

    test('a newer attempt that has not reached a job yet: that job is not pending, its run is', () => {
        const jobs = [wfJob('build', 'success', { run_attempt: 1 }), wfJob('lint', null, { id: 2, run_attempt: 2 })];
        expect(judge([wfRun(RUN, { run_attempt: 2, status: 'in_progress', conclusion: null })], jobs)).toEqual(
            verdict(false, false),
        );
    });

    test('all jobs succeeded: complete and green', () => {
        const jobs = [wfJob('build', 'success'), wfJob('lint', 'skipped', { id: 2 })];
        expect(judge(one, jobs)).toEqual(verdict(true, true));
    });

    test('a failed job that is not required: complete, not green', () => {
        const jobs = [wfJob('build', 'success'), wfJob('audit', 'failure', { id: 2 })];
        expect(judge(one, jobs)).toEqual(verdict(true, false));
    });

    test('a job still running: not complete', () => {
        expect(judge(one, [wfJob('build', 'success'), wfJob('slow', null, { id: 2 })])).toEqual(verdict(false, false));
    });

    test.each(['cancelled', 'timed_out', 'action_required', 'stale'])('a %s job: no verdict', (conclusion) => {
        const jobs = [wfJob('build', 'success'), wfJob('other', conclusion, { id: 2 })];
        expect(judge(one, jobs)).toEqual(verdict(false, false));
    });

    test('a run still in progress is pending, whatever jobs it lists so far', () => {
        const running = [wfRun(RUN, { status: 'in_progress', conclusion: null })];
        expect(judge(running, [wfJob('build', 'success')])).toEqual(verdict(false, false));
        expect(ciObservations(running, [wfJob('build', 'success')], statuses([]), HEAD)?.observations).toContainEqual({
            context: `actions run ${RUN}`,
            appId: null,
            headSha: HEAD,
            state: 'pending',
        });
    });

    test('a completed run with no jobs (it failed to start) counts with its own conclusion', () => {
        const failed = wfRun(12, { conclusion: 'startup_failure' });
        expect(judge([...one, failed], [wfJob('build', 'success')])).toEqual(verdict(false, false));
        const red = wfRun(12, { conclusion: 'failure' });
        expect(judge([...one, red], [wfJob('build', 'success')])).toEqual(verdict(true, false));
    });

    test('a run-level observation never stands in for a required context', () => {
        expect(judge([wfRun(RUN, { name: 'build' })], [])).toEqual(verdict(false, false));
    });

    test('a required context that is neither a job nor a status: no verdict', () => {
        expect(judge(one, [wfJob('lint', 'success')], statuses([{ context: 'ci/x', state: 'success' }]))).toEqual(
            verdict(false, false),
        );
    });

    test('no runs at all: the required context has no verdict', () => {
        expect(judge([], [])).toEqual(verdict(false, false));
    });

    test('one job name in two runs (push and pull_request) that disagree: no verdict', () => {
        const jobs = [wfJob('build', 'success'), wfJob('build', 'failure', { id: 2, run_id: 12 })];
        expect(judge([...one, wfRun(12)], jobs)).toEqual(verdict(false, false));
    });

    test('commit statuses are judged too, and carry no app id', () => {
        const red = statuses([{ context: 'ci/x', state: 'failure' }]);
        const input = ciObservations(one, [wfJob('build', 'success')], red, HEAD);
        expect(input?.observations).toEqual([
            { context: 'build', appId: ACTIONS, headSha: HEAD, state: 'success' },
            { context: 'ci/x', appId: null, headSha: HEAD, state: 'failure' },
        ]);
        expect(input?.expectedCount).toBe(2);
        expect(judge(one, [wfJob('build', 'success')], statuses([{ context: 'ci/x', state: 'failure' }]))).toEqual(
            verdict(true, false),
        );
    });

    test('the coordinator gate status is left out of the verdict', () => {
        expect(judge(one, [wfJob('build', 'success')], statuses([{ context: 'gate', state: 'pending' }]))).toEqual(
            verdict(true, true),
        );
    });

    test.each<[string, unknown[], unknown[], unknown]>([
        ['a run on another commit', [wfRun(RUN, { head_sha: BASE })], [], statuses([])],
        ['a run listed twice', [wfRun(RUN), wfRun(RUN)], [], statuses([])],
        ['a run with no attempt number', [wfRun(RUN, { run_attempt: undefined })], [], statuses([])],
        ['a completed run with no conclusion', [wfRun(RUN, { conclusion: null })], [], statuses([])],
        ['a job on another commit', one, [wfJob('build', 'success', { head_sha: BASE })], statuses([])],
        ['a job of a run not listed', one, [wfJob('build', 'success', { run_id: 99 })], statuses([])],
        ['a job listed twice', one, [wfJob('build', 'success'), wfJob('build', 'success')], statuses([])],
        ['a job with no name', one, [wfJob('', 'success')], statuses([])],
        ['a job with no attempt number', one, [wfJob('build', 'success', { run_attempt: 0 })], statuses([])],
        ['a completed job with no conclusion', one, [wfJob('build', 'success', { conclusion: null })], statuses([])],
        ['a job that is not an object', one, ['build'], statuses([])],
        ['statuses for another commit', one, [], statuses([], { sha: BASE })],
        ['a truncated status list', one, [], statuses([], { total_count: 3 })],
        ['a status with no state', one, [], json({ sha: HEAD, total_count: 1, statuses: [{ context: 'x' }] })],
        ['statuses missing', one, [], undefined],
    ])('%s: null', (_name, runList, jobList, status) => {
        expect(ciObservations(runList, jobList, status, HEAD)).toBeNull();
    });

    test('a head that is not a full sha: null', () => {
        expect(ciObservations([], [], statuses([]), 'abc1234')).toBeNull();
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
        return { github: new GitHub(runner, () => 'tok'), calls };
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
            ['gh', 'api', 'repos/owner/name/pulls/7', '--hostname', 'github.com'],
            ['gh', 'api', 'repos/owner/name/git/ref/heads/main', '--hostname', 'github.com'],
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
        const throwing = new GitHub(
            () => {
                throw new Error('spawn failed');
            },
            () => 'tok',
        );
        expect(await throwing.readPr(ref)).toEqual({ kind: 'unknown' });
        expect(await throwing.inventory(REPO)).toEqual({ complete: false, prs: [] });
        expect(await throwing.ci(REPO, HEAD)).toBeNull();
        expect(await throwing.gate({ repo: REPO, head: HEAD }, 'gate')).toEqual({ kind: 'unknown' });
    });

    test('a non-zero exit is not read, whatever it printed', async () => {
        const merged = json(pull({ state: 'closed', merged: true, merge_commit_sha: MERGE }));
        const failed = (exitCode: number | null) => new GitHub(() => ({ exitCode, stdout: merged }), () => 'tok');
        expect(await failed(1).readPr(ref)).toEqual({ kind: 'unknown' });
        expect(await failed(null).readPr(ref)).toEqual({ kind: 'unknown' });
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

    const RUNS = `repos/owner/name/actions/runs?head_sha=${HEAD}&per_page=100`;
    const JOBS = 'repos/owner/name/actions/runs/11/jobs?filter=all&per_page=100';
    const STATUS = `repos/owner/name/commits/${HEAD}/status?per_page=100`;
    const runsPage = (list: unknown[], total = list.length) => json({ total_count: total, workflow_runs: list });
    const jobsPage = (list: unknown[], total = list.length) => json({ total_count: total, jobs: list });
    const manyJobs = (n: number, from = 1) =>
        Array.from({ length: n }, (_, i) => wfJob(`job ${from + i}`, 'success', { id: from + i }));

    test('inventory and gate ask for one page; ci for the runs on the head, all their jobs, and statuses', async () => {
        const { github, calls } = scripted({
            'repos/owner/name/pulls?state=open&per_page=100': json([listed()]),
            [`${RUNS}&page=1`]: runsPage([wfRun(11)]),
            [`${JOBS}&page=1`]: jobsPage([wfJob('build', 'success')]),
            [STATUS]: statuses([{ context: 'gate', state: 'success' }]),
        });
        expect((await github.inventory(REPO)).prs).toHaveLength(1);
        expect((await github.ci(REPO, HEAD))?.expectedCount).toBe(2);
        expect(await github.gate({ repo: REPO, head: HEAD }, 'gate')).toEqual({ kind: 'success' });
        expect(calls.map((c) => c[2])).toEqual([
            'repos/owner/name/pulls?state=open&per_page=100',
            `${RUNS}&page=1`,
            `${JOBS}&page=1`,
            STATUS,
            STATUS,
        ]);
    });

    test("ci: a job that run 11's endpoint lists under run 12 is refused, though run 12 is listed (#361)", async () => {
        const { github } = scripted({
            [`${RUNS}&page=1`]: runsPage([wfRun(11), wfRun(12)]),
            [`${JOBS}&page=1`]: jobsPage([wfJob('build', 'success', { run_id: 12 })]),
            ['repos/owner/name/actions/runs/12/jobs?filter=all&per_page=100&page=1']: jobsPage([]),
            [STATUS]: statuses([]),
        });
        expect(await github.ci(REPO, HEAD)).toBeNull();
    });

    test('ci: a run id that is not one is never put in a path', async () => {
        const { github, calls } = scripted({
            [`${RUNS}&page=1`]: runsPage([wfRun(11, { id: '11/../../x' })]),
            [STATUS]: statuses([]),
        });
        expect(await github.ci(REPO, HEAD)).toBeNull();
        expect(calls.map((c) => c[2])).toEqual([`${RUNS}&page=1`]);
    });

    test('ci: the Actions app id is the one branch protection names (Envoak, treebird; 2026-11-20)', () => {
        expect(ACTIONS_APP_ID).toBe(ACTIONS);
    });

    test('ci: a listing longer than a page is read page by page', async () => {
        const { github } = scripted({
            [`${RUNS}&page=1`]: runsPage([wfRun(11)]),
            [`${JOBS}&page=1`]: jobsPage(manyJobs(PAGE), PAGE + 1),
            [`${JOBS}&page=2`]: jobsPage(manyJobs(1, PAGE + 1), PAGE + 1),
            [STATUS]: statuses([]),
        });
        expect((await github.ci(REPO, HEAD))?.expectedCount).toBe(PAGE + 1);
    });

    test('ci: a listing of exactly one page asks for the next and finds it empty', async () => {
        const { github } = scripted({
            [`${RUNS}&page=1`]: runsPage([wfRun(11)]),
            [`${JOBS}&page=1`]: jobsPage(manyJobs(PAGE)),
            [`${JOBS}&page=2`]: jobsPage([], PAGE),
            [STATUS]: statuses([]),
        });
        expect((await github.ci(REPO, HEAD))?.expectedCount).toBe(PAGE);
    });

    test.each<[string, Record<string, string>]>([
        ['the runs listing cannot be read', { [`${JOBS}&page=1`]: jobsPage([]) }],
        ['a jobs listing cannot be read', { [`${RUNS}&page=1`]: runsPage([wfRun(11)]) }],
        ['a runs listing with no total', { [`${RUNS}&page=1`]: json({ workflow_runs: [] }) }],
        ['fewer runs than the total', { [`${RUNS}&page=1`]: runsPage([], 1) }],
        ['a run with no id', { [`${RUNS}&page=1`]: runsPage([wfRun(11, { id: undefined })]) }],
        [
            'pages that disagree on the total (a run started in between)',
            {
                [`${RUNS}&page=1`]: runsPage([wfRun(11)]),
                [`${JOBS}&page=1`]: jobsPage(manyJobs(PAGE), PAGE + 1),
                [`${JOBS}&page=2`]: jobsPage(manyJobs(2, PAGE + 1), PAGE + 2),
            },
        ],
        [
            'a page larger than asked for',
            {
                [`${RUNS}&page=1`]: runsPage([wfRun(11)]),
                [`${JOBS}&page=1`]: jobsPage(manyJobs(PAGE + 1)),
                [`${JOBS}&page=2`]: jobsPage([], PAGE + 1),
            },
        ],
        [
            'more pages than MAX_PAGES',
            Object.fromEntries([
                [`${RUNS}&page=1`, runsPage([wfRun(11)])],
                ...Array.from({ length: MAX_PAGES + 1 }, (_, i) => [
                    `${JOBS}&page=${i + 1}`,
                    jobsPage(manyJobs(PAGE, i * PAGE + 1), (MAX_PAGES + 1) * PAGE),
                ]),
            ]),
        ],
    ])('ci: %s: null', async (_name, table) => {
        const { github } = scripted({ [STATUS]: statuses([]), ...table });
        expect(await github.ci(REPO, HEAD)).toBeNull();
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

    test('inventory: the title is carried as given', async () => {
        const { github } = scripted({
            'repos/owner/name/pulls?state=open&per_page=100': json([listed({ title: 'feat (sp-abcd)' })]),
        });
        expect((await github.inventory(REPO)).prs[0]?.title).toBe('feat (sp-abcd)');
    });

    test('diff: asks for the diff media type and gives the text, or undefined', async () => {
        const calls: string[][] = [];
        let answer: CommandResult = { exitCode: 0, stdout: 'diff --git a/x b/x\n' };
        const github = new GitHub(
            (command, argv) => {
                calls.push([command, ...argv]);
                return answer;
            },
            () => 'tok',
        );
        expect(await github.diff(ref)).toBe('diff --git a/x b/x\n');
        expect(calls).toEqual([
            [
                'gh',
                'api',
                '-H',
                'Accept: application/vnd.github.diff',
                'repos/owner/name/pulls/7',
                '--hostname',
                'github.com',
            ],
        ]);
        answer = { exitCode: 1, stdout: 'diff --git a/x b/x\n' };
        expect(await github.diff(ref)).toBeUndefined();
        answer = { exitCode: 0, stdout: '' };
        expect(await github.diff(ref)).toBeUndefined();
        expect(await github.diff({ repo: 'nope', pr: 7 })).toBeUndefined();
    });

    describe('tokens (sp-vkqq)', () => {
        const merged = json(pull({ state: 'closed', merged: true, merge_commit_sha: MERGE }));
        /** A runner that records the token each call ran with. */
        function withTokens(token: (repo: string) => string | undefined) {
            const seen: { path: string | undefined; token: string | undefined }[] = [];
            const github = new GitHub((_command, argv, options) => {
                seen.push({ path: argv[1], token: options.githubToken });
                return { exitCode: 0, stdout: merged };
            }, token);
            return { github, seen };
        }

        test("each repo is read with its own owner's token", async () => {
            const tokens: Record<string, string> = { owner: 'owner-token', other: 'other-token' };
            const { github, seen } = withTokens((repo) => tokens[repo.split('/')[0] ?? '']);
            await github.readPr(ref);
            await github.detail({ repo: 'other/name', pr: 7 });
            expect(seen).toEqual([
                { path: 'repos/owner/name/pulls/7', token: 'owner-token' },
                { path: 'repos/other/name/pulls/7', token: 'other-token' },
            ]);
        });

        test.each([
            ['no token', undefined],
            ['an empty token (gh would use its own login)', ''],
            ['a token with a space', 'a b'],
            ['a token with a newline', 'a\nb'],
        ])('%s: nothing is run, and the read is unknown', async (_name, token) => {
            const { github, seen } = withTokens(() => token);
            expect(await github.readPr(ref)).toEqual({ kind: 'unknown' });
            expect(await github.inventory(REPO)).toEqual({ complete: false, prs: [] });
            expect(seen).toEqual([]);
        });
    });
});
