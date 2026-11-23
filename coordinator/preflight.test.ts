import { describe, expect, test } from 'bun:test';
import { branchPath } from './github';
import { EXPIRY_WARN_MS, parseExpiry, parseResponse, preflight, tokensFrom } from './preflight';
import type { CommandResult } from './readers';
import type { Mode } from './types';

const REPO = 'owner/name';
const TOKEN = `github_pat_${'s'.repeat(82)}`;
const TIP = 'b'.repeat(40);
const ZERO = '0'.repeat(40);
const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const TOKENS = { owner: 'OWNER_PAT' };
const ENV = { OWNER_PAT: TOKEN };
const NOT_GITHUB = 'OWNER_PAT does not hold a GitHub token (github_pat_, ghp_, gho_, ghs_ or ghu_)';

/**
 * `gh api -i` output: the status line, the headers as gh prints them (re-cased), a blank line, the body.
 * Shape of a real 422 from the status write probe, 2026-11-20.
 */
function http(status: number, body: unknown = {}, headers: Record<string, string> = {}): string {
    const lines = [`HTTP/2.0 ${status} ${status === 200 ? 'OK' : 'Unprocessable Entity'}`, 'Content-Type: application/json'];
    for (const [name, value] of Object.entries(headers)) lines.push(`${name}: ${value}`);
    return `${lines.join('\r\n')}\r\n\r\n${JSON.stringify(body)}`;
}

const META = { full_name: REPO, default_branch: 'main' };
const EXPIRES = { 'Github-Authentication-Token-Expiration': '2027-02-18 00:00:00 UTC' };

/** Every answer a healthy token gets, keyed by the path argument. */
function healthy(): Record<string, string> {
    return {
        [`repos/${REPO}`]: http(200, META, EXPIRES),
        [`repos/${REPO}/pulls?state=open&per_page=1`]: http(200, []),
        [`repos/${REPO}/git/ref/heads/main`]: http(200, { ref: 'refs/heads/main', object: { type: 'commit', sha: TIP } }),
        [`repos/${REPO}/commits/${TIP}/status?per_page=1`]: http(200, { sha: TIP, statuses: [] }),
        [`repos/${REPO}/actions/runs?per_page=1`]: http(200, { total_count: 0, workflow_runs: [] }),
        // The body GitHub really sends, 2026-11-23.
        [`repos/${REPO}/statuses/${ZERO}`]: http(422, {
            message: `No commit found for SHA: ${ZERO}`,
            documentation_url: 'https://docs.github.com/rest/commits/statuses#create-a-commit-status',
            status: '422',
        }),
    };
}

function scripted(table: Record<string, string>) {
    const calls: { argv: readonly string[]; token: string | undefined }[] = [];
    const run = (_command: string, argv: readonly string[], options: { githubToken?: string }): CommandResult => {
        calls.push({ argv, token: options.githubToken });
        const path = argv.find((a) => a.startsWith('repos/'));
        const stdout = path === undefined ? undefined : table[path];
        // gh exits 1 on any 4xx, and still prints the response with -i.
        if (stdout === undefined) return { exitCode: 1, stdout: '' };
        return { exitCode: stdout.startsWith('HTTP/2.0 200') ? 0 : 1, stdout };
    };
    return { run, calls };
}

async function check(
    table: Record<string, string>,
    mode: Mode = 'live',
    env: Record<string, string | undefined> = ENV,
    now: number = NOW,
) {
    const { run, calls } = scripted(table);
    const result = await preflight(run, [{ repo: REPO, mode }], TOKENS, env, now);
    return { ...result, calls };
}

describe('parseResponse', () => {
    test('status, re-cased headers, JSON body', () => {
        const r = parseResponse(http(422, { message: 'x' }, { 'X-Accepted-Github-Permissions': 'statuses=write' }));
        expect(r?.status).toBe(422);
        expect(r?.headers.get('x-accepted-github-permissions')).toBe('statuses=write');
        expect(r?.body).toEqual({ message: 'x' });
    });

    test.each([['no status line', '{"a":1}'], ['nothing', ''], ['not text', undefined]])('%s: null', (_n, out) => {
        expect(parseResponse(out)).toBeNull();
    });
});

describe('parseExpiry', () => {
    test('the header form GitHub sends', () => {
        expect(parseExpiry('2027-02-18 00:00:00 UTC')).toBe(Date.parse('2027-02-18T00:00:00Z'));
        expect(parseExpiry('2027-02-18 00:00:00 -0700')).toBe(Date.parse('2027-02-18T07:00:00Z'));
    });

    test('no header: no expiry', () => {
        expect(parseExpiry(undefined)).toBeNull();
    });

    test.each(['tomorrow', '2027-02-18', '2027-02-18T00:00:00Z', ''])('%s: unreadable', (value) => {
        expect(parseExpiry(value)).toBeNaN();
    });
});

describe('preflight', () => {
    test('a healthy token in a live repo: every read, then the write probe; the token only in the run env', async () => {
        const done = await check(healthy());
        expect(done.problems).toEqual([]);
        expect(done.warnings).toEqual([]);
        expect(done.passed).toEqual([`${REPO}: OWNER_PAT reads and writes statuses (live, expires 2027-02-18)`]);
        expect(done.calls.map((c) => c.argv.find((a) => a.startsWith('repos/')))).toEqual(Object.keys(healthy()));
        expect(done.calls.every((c) => c.token === TOKEN && !c.argv.some((a) => a.includes(TOKEN)))).toBe(true);
        expect(done.calls[5]?.argv).toEqual([
            'api',
            '-i',
            '-X',
            'POST',
            `repos/${REPO}/statuses/${ZERO}`,
            '-f',
            'state=pending',
            '-f',
            'context=spidersan/preflight',
            '--hostname',
            'github.com',
        ]);
        expect(done.calls.every((c) => c.argv.slice(-2).join(' ') === '--hostname github.com')).toBe(true);
    });

    test.each<Mode>(['dry-run', 'review-only'])('%s writes nothing to GitHub: no write probe', async (mode) => {
        const table = healthy();
        delete table[`repos/${REPO}/statuses/${ZERO}`];
        const done = await check(table, mode);
        expect(done.problems).toEqual([]);
        expect(done.calls.some((c) => c.argv.includes('POST'))).toBe(false);
    });

    test.each([
        ['not set', {}, 'OWNER_PAT is not set'],
        ['empty (gh would use its own login)', { OWNER_PAT: '' }, 'OWNER_PAT is not set'],
        ['with a space', { OWNER_PAT: 'github_pat_a b' }, NOT_GITHUB],
        ["another service's credential (#361)", { OWNER_PAT: `sk-ant-oat01-${'d'.repeat(60)}` }, NOT_GITHUB],
        ['a GitHub prefix with too little after it', { OWNER_PAT: 'github_pat_short' }, NOT_GITHUB],
        ['a refresh token (ghr_), which is no API token', { OWNER_PAT: `ghr_${'r'.repeat(36)}` }, NOT_GITHUB],
        ['in GH_TOKEN only', { GH_TOKEN: TOKEN }, 'OWNER_PAT is not set'],
    ])('a token %s: refused before gh is asked, the value never printed', async (_name, env, why) => {
        const done = await check(healthy(), 'live', env);
        expect(done.problems).toEqual([`${REPO}: ${why}`]);
        expect(done.calls).toEqual([]);
        for (const value of Object.values(env)) if (value !== '') expect(done.problems.join()).not.toContain(value);
    });

    test.each([
        ['a classic PAT', `ghp_${'c'.repeat(36)}`],
        ['an app installation token', `ghs_${'s'.repeat(36)}`],
    ])('%s is a GitHub token', async (_name, token) => {
        expect((await check(healthy(), 'live', { OWNER_PAT: token })).problems).toEqual([]);
    });

    test('a repo whose owner has no entry: refused', async () => {
        const { run, calls } = scripted(healthy());
        const done = await preflight(run, [{ repo: 'other/name', mode: 'dry-run' }], TOKENS, ENV, NOW);
        expect(done.problems).toEqual(['other/name: no githubTokens entry for its owner']);
        expect(calls).toEqual([]);
    });

    const deny = (status: number) =>
        http(status, { message: 'Resource not accessible by personal access token' }, {
            'X-Accepted-Github-Permissions': 'actions=read',
        });

    test.each([
        ['the repository', `repos/${REPO}`, 'cannot read the repository'],
        ['pull requests', `repos/${REPO}/pulls?state=open&per_page=1`, 'cannot read pull requests'],
        ['contents', `repos/${REPO}/git/ref/heads/main`, 'cannot read contents'],
        ['commit statuses', `repos/${REPO}/commits/${TIP}/status?per_page=1`, 'cannot read commit statuses'],
        ['Actions runs', `repos/${REPO}/actions/runs?per_page=1`, 'cannot read Actions runs'],
    ])('a 403 on %s: refused, naming what GitHub asks for, never the token', async (_name, path, why) => {
        const done = await check({ ...healthy(), [path]: deny(403) });
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT ${why} (HTTP 403, GitHub asks for actions=read)`]);
        expect(done.problems.join()).not.toContain(TOKEN);
        expect(done.passed).toEqual([]);
    });

    test.each([
        ['no answer at all', undefined, 'gh exit 1, no answer'],
        ['a 404 (no access to the repo)', http(404), 'HTTP 404'],
    ])('the repository read gives %s: refused', async (_name, answer, why) => {
        const table: Record<string, string> = healthy();
        if (answer === undefined) delete table[`repos/${REPO}`];
        else table[`repos/${REPO}`] = answer;
        expect((await check(table)).problems).toEqual([`${REPO}: OWNER_PAT cannot read the repository (${why})`]);
    });

    test('the repo spelled another way than GitHub does: refused (inventory compares names exactly)', async () => {
        const done = await check({ ...healthy(), [`repos/${REPO}`]: http(200, { ...META, full_name: 'Owner/Name' }) });
        expect(done.problems[0]).toContain('reads the repository as Owner/Name');
    });

    test('a default branch that would climb out of the ref path: refused', async () => {
        const done = await check({ ...healthy(), [`repos/${REPO}`]: http(200, { ...META, default_branch: 'a/../b' }) });
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT cannot read the default branch name`]);
    });

    test('a default branch with a leading underscore is a branch: its ref is read, and it passes (#361)', async () => {
        const table = healthy();
        delete table[`repos/${REPO}/git/ref/heads/main`];
        table[`repos/${REPO}`] = http(200, { ...META, default_branch: '_release' }, EXPIRES);
        table[`repos/${REPO}/git/ref/heads/_release`] = http(200, { object: { sha: TIP } });
        const done = await check(table);
        expect(done.problems).toEqual([]);
        expect(done.calls.some((c) => c.argv.includes(`repos/${REPO}/git/ref/heads/_release`))).toBe(true);
    });

    test.each<[string, string, unknown, string]>([
        ['pulls as {}', `repos/${REPO}/pulls?state=open&per_page=1`, {}, 'cannot read pull requests'],
        ['pulls as null', `repos/${REPO}/pulls?state=open&per_page=1`, null, 'cannot read pull requests'],
        ['the status as {}', `repos/${REPO}/commits/${TIP}/status?per_page=1`, {}, 'cannot read commit statuses'],
        ['the status as null', `repos/${REPO}/commits/${TIP}/status?per_page=1`, null, 'cannot read commit statuses'],
        [
            'the status of another commit',
            `repos/${REPO}/commits/${TIP}/status?per_page=1`,
            { sha: 'c'.repeat(40), statuses: [] },
            'cannot read commit statuses',
        ],
        [
            'a status with no list',
            `repos/${REPO}/commits/${TIP}/status?per_page=1`,
            { sha: TIP, statuses: null },
            'cannot read commit statuses',
        ],
    ])('%s: refused (#361)', async (_name, path, body, why) => {
        const done = await check({ ...healthy(), [path]: http(200, body) });
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT ${why} (HTTP 200)`]);
    });

    test('an Actions answer that is JSON but not a runs listing: refused (#361)', async () => {
        const done = await check({ ...healthy(), [`repos/${REPO}/actions/runs?per_page=1`]: http(200, {}) });
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT cannot read Actions runs (HTTP 200)`]);
        const path = `repos/${REPO}/actions/runs?per_page=1`;
        const runsAnswer = (body: unknown) => check({ ...healthy(), [path]: http(200, body) });
        expect((await runsAnswer({ total_count: 0, workflow_runs: null })).problems).toHaveLength(1);
        expect((await runsAnswer({ workflow_runs: [] })).problems).toHaveLength(1);
        expect((await runsAnswer(null)).problems).toHaveLength(1);
        expect((await runsAnswer({ total_count: 0, workflow_runs: [] })).problems).toEqual([]);
    });

    test('a branch tip that is not a full sha: refused', async () => {
        const ref = http(200, { object: { sha: 'abc' } });
        const done = await check({ ...healthy(), [`repos/${REPO}/git/ref/heads/main`]: ref });
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT cannot read contents (HTTP 200)`]);
    });

    test('a contents read that is not a 200 is refused, even with a sha in its body', async () => {
        const ref = http(203, { object: { sha: TIP } });
        const done = await check({ ...healthy(), [`repos/${REPO}/git/ref/heads/main`]: ref });
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT cannot read contents (HTTP 203)`]);
    });

    test('live, and the token may not write statuses: refused', async () => {
        const post = http(403, {}, { 'X-Accepted-Github-Permissions': 'statuses=write' });
        const done = await check({ ...healthy(), [`repos/${REPO}/statuses/${ZERO}`]: post });
        expect(done.problems).toEqual([
            `${REPO}: OWNER_PAT cannot write commit statuses (HTTP 403, GitHub asks for statuses=write)`,
        ]);
    });

    test.each([
        ['201 (a status was created)', http(201)],
        ['404', http(404)],
        ['no answer', undefined],
    ])('live, and the write probe answers %s: refused, only 422 passes', async (_name, answer) => {
        const table: Record<string, string> = healthy();
        if (answer === undefined) delete table[`repos/${REPO}/statuses/${ZERO}`];
        else table[`repos/${REPO}/statuses/${ZERO}`] = answer;
        const done = await check(table);
        expect(done.problems).toHaveLength(1);
        expect(done.problems[0]).toContain('status write probe');
    });

    test('a 422 for another reason than the missing commit is no proof of write access (#361)', async () => {
        const other = http(422, { message: 'Validation Failed', errors: [{ field: 'state', code: 'invalid' }] });
        const done = await check({ ...healthy(), [`repos/${REPO}/statuses/${ZERO}`]: other });
        expect(done.problems).toHaveLength(1);
        expect(done.problems[0]).toContain('status write probe: HTTP 422');
    });

    test('the missing-commit body under another status than 422: refused', async () => {
        const body = { message: `No commit found for SHA: ${ZERO}`, status: '422' };
        const done = await check({ ...healthy(), [`repos/${REPO}/statuses/${ZERO}`]: http(400, body) });
        expect(done.problems[0]).toContain('status write probe: HTTP 400');
    });

    test('a 422 with the right body but an exit gh never gives for one: refused', async () => {
        const { run } = scripted(healthy());
        const exit0 = (c: string, argv: readonly string[], o: { githubToken?: string }) => {
            const r = run(c, argv, o);
            return argv.includes('POST') ? { ...r, exitCode: 0 } : r;
        };
        const done = await preflight(exit0, [{ repo: REPO, mode: 'live' }], TOKENS, ENV, NOW);
        expect(done.problems[0]).toContain('status write probe');
    });

    test.each([
        ['killed after a 200 header (exit null)', null, 'HTTP/2.0 200 OK\r\nContent-Type: application/json'],
        ['killed mid-body (exit null)', null, 'HTTP/2.0 200 OK\r\n\r\n{"total_count": 1, "workf'],
        ['a 200 with exit 1', 1, http(200, { total_count: 0, workflow_runs: [] })],
        ['exit 0 with a body that is not JSON', 0, 'HTTP/2.0 200 OK\r\n\r\n{"total'],
        ['exit 0 with a status that is not 200', 0, http(203, { total_count: 0, workflow_runs: [] })],
    ])('the Actions runs probe %s: refused (#361 P1-2)', async (_name, exitCode, stdout) => {
        const { run } = scripted(healthy());
        const partial = (c: string, argv: readonly string[], o: { githubToken?: string }) =>
            argv.some((a) => a.includes('actions/runs')) ? { exitCode, stdout } : run(c, argv, o);
        const done = await preflight(partial, [{ repo: REPO, mode: 'dry-run' }], TOKENS, ENV, NOW);
        expect(done.problems).toHaveLength(1);
        expect(done.problems[0]).toContain('cannot read Actions runs');
        expect(done.passed).toEqual([]);
    });

    test('an expired token: refused', async () => {
        const done = await check(healthy(), 'live', ENV, Date.parse('2027-02-18T00:00:00Z'));
        expect(done.problems).toEqual([`${REPO}: OWNER_PAT expired at 2027-02-18T00:00:00.000Z`]);
    });

    test('an expiry GitHub states in a form not read here: refused', async () => {
        const meta = http(200, META, { 'Github-Authentication-Token-Expiration': 'soon' });
        const done = await check({ ...healthy(), [`repos/${REPO}`]: meta });
        expect(done.problems[0]).toContain('has an expiry GitHub states in a form not read here');
    });

    test('under 14 days from expiry: starts, with a warning', async () => {
        const expiry = Date.parse('2027-02-18T00:00:00Z');
        const near = await check(healthy(), 'live', ENV, expiry - EXPIRY_WARN_MS + DAY);
        expect(near.problems).toEqual([]);
        expect(near.warnings).toEqual([`${REPO}: OWNER_PAT expires in 13 day(s), at 2027-02-18T00:00:00.000Z`]);
        expect((await check(healthy(), 'live', ENV, expiry - EXPIRY_WARN_MS - DAY)).warnings).toEqual([]);
    });

    test('no expiry header: a token that does not expire', async () => {
        const done = await check({ ...healthy(), [`repos/${REPO}`]: http(200, META) });
        expect(done.problems).toEqual([]);
        expect(done.passed[0]).toContain('no expiry');
    });

    test("each repo is probed with its own owner's token", async () => {
        const seen: [string | undefined, string | undefined][] = [];
        const run = (_c: string, argv: readonly string[], options: { githubToken?: string }): CommandResult => {
            seen.push([argv[2], options.githubToken]);
            return { exitCode: 1, stdout: http(404) };
        };
        const tokens = { owner: 'OWNER_PAT', other: 'OTHER_PAT' };
        const env = { OWNER_PAT: `ghp_${'o'.repeat(36)}`, OTHER_PAT: `ghs_${'x'.repeat(36)}` };
        const repos = [
            { repo: REPO, mode: 'dry-run' as const },
            { repo: 'other/name', mode: 'dry-run' as const },
        ];
        const done = await preflight(run, repos, tokens, env, NOW);
        expect(done.problems).toHaveLength(2);
        expect(seen).toEqual([
            ['repos/owner/name', `ghp_${'o'.repeat(36)}`],
            ['repos/other/name', `ghs_${'x'.repeat(36)}`],
        ]);
    });
});

describe('tokensFrom', () => {
    test("a repo's token is its owner's variable; anything else has none", () => {
        const token = tokensFrom({ owner: 'OWNER_PAT' }, { OWNER_PAT: 't', GH_TOKEN: 'ambient' });
        expect(token(REPO)).toBe('t');
        expect(token('other/name')).toBeUndefined();
    });
});

describe('branchPath', () => {
    test.each([
        ['main', 'main'],
        ['_release', '_release'],
        ['.hidden', '.hidden'],
        ['release/1.0', 'release/1.0'],
        ['feat/a#b?c', 'feat/a%23b%3Fc'],
        ['-dash', '-dash'],
    ])('%s → %s', (name, path) => {
        expect(branchPath(name)).toBe(path);
    });

    test.each(['', '..', 'a/../b', 'a//b', '/a', 'a/', 'a b', 'a\nb', 'a/./b'])('%j: null', (name) => {
        expect(branchPath(name)).toBeNull();
    });

    test.each([undefined, 7, null])('%p: null', (name) => {
        expect(branchPath(name)).toBeNull();
    });
});
