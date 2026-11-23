import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    EXIT_CONFIG,
    EXIT_CREDENTIALS,
    childEnv,
    fileIo,
    parseConfig,
    privateGhConfig,
    readHostId,
    runCommand,
    start,
} from './main';

const LAUNCHER = resolve(import.meta.dir, 'spidersan-coordinator');
const MAIN = resolve(import.meta.dir, 'main.ts');
const HOST = readHostId();

/** The loop's part of the config, with no repos: reconcile, then a pass over nothing. */
const LOOP = {
    self: 'spidersan',
    owner: 'treebird',
    escalationProject: 'sp',
    maxReviewsPerPass: 10,
    githubTokens: {},
    prsan: {
        home: '/nonexistent/prsan',
        timeoutMs: 1000,
        models: { luna: 'luna', terra: 'terra', sol: 'sol' },
        families: { 'a/luna': 'luna', 'a/terra': 'terra', 'a/sol': 'sol' },
    },
    repos: {},
};

let dir: string;
let db: string;
let config: string;

/** An `invoak` first on PATH that answers every command with `stdout`. */
function fakeInvoak(stdout: string): void {
    writeFileSync(join(dir, 'bin', 'invoak'), `#!/bin/sh\nprintf '%s' '${stdout}'\n`, { mode: 0o755 });
}

/**
 * A `gh` first on PATH that answers `gh api -i <path>` like GitHub for owner/name, and appends the
 * GH_TOKEN it was given and its argv to `gh.log`. `status` answers every call with that code instead.
 */
function fakeGh(status?: number): void {
    const ok = (body: string) => `printf 'HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n%s' '${body}'`;
    const answer =
        status !== undefined
            ? `printf 'HTTP/2.0 ${status} No\\r\\nX-Accepted-GitHub-Permissions: statuses=read\\r\\n\\r\\n{}'; exit 1`
            : [
                  'case "$*" in',
                  `  *statuses/0000000000000000000000000000000000000000*) printf 'HTTP/2.0 422 Unprocessable Entity\\r\\n\\r\\n%s' '${NO_COMMIT}'; exit 1 ;;`,
                  // The coordinator passes gh no variable of the test's own, so a file switches this on.
                  `  *actions/runs*) ` +
                      `[ -f '${join(dir, 'partial')}' ] && { printf 'HTTP/2.0 200 OK\\r\\n'; kill -9 $$; }; ` +
                      `[ -f '${join(dir, 'not-a-listing')}' ] && { ${ok('{}')}; exit 0; }; ${ok(EMPTY_RUNS)} ;;`,
                  `  *git/ref/heads/main*) ${ok(JSON.stringify({ object: { sha: 'b'.repeat(40) } }))} ;;`,
                  `  *"api -i repos/owner/name --hostname github.com") ${ok(JSON.stringify(META))} ;;`,
                  `  *) ${ok('{}')} ;;`,
                  'esac',
              ].join('\n');
    writeFileSync(
        join(dir, 'bin', 'gh'),
        `#!/bin/sh\nprintf '%s|%s|%s\\n' "$GH_TOKEN" "$GH_HOST" "$*" >> '${join(dir, 'gh.log')}'\n${answer}\n`,
        { mode: 0o755 },
    );
}

/** LOOP with one dry-run repo, owner/name, whose token is in OWNER_PAT. */
function withRepo(): Record<string, unknown> {
    const policy = {
        mode: 'dry-run',
        ceiling: 5,
        reservations: { triage: 0.05, plain: 0.5, second: 0.5, vector: 0.5 },
        maxHeads: 4,
        secondFamily: 'luna',
        stallClaimantMs: 1,
        stallOwnerMs: 2,
        effectsClassified: false,
        mergeGateApplied: false,
        webhookInstalled: false,
    };
    return {
        ...LOOP,
        githubTokens: { owner: 'OWNER_PAT' },
        repos: { 'owner/name': { taskProjects: ['sp'], policy, touches: { protectedPaths: ['x/'], mergeEffects: [] } } },
    };
}

const META = { full_name: 'owner/name', default_branch: 'main' };
const EMPTY_RUNS = JSON.stringify({ total_count: 0, workflow_runs: [] });
const NO_COMMIT = JSON.stringify({ message: `No commit found for SHA: ${'0'.repeat(40)}`, status: '422' });

function writeConfig(value: unknown): void {
    writeFileSync(config, JSON.stringify(value));
}

function run(command: string[], env: Record<string, string> = {}) {
    const done = Bun.spawnSync(command, {
        env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return {
        exit: done.exitCode,
        out: done.stdout.toString(),
        err: done.stderr.toString(),
    };
}

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coord-main-'));
    db = join(dir, 'state.db');
    config = join(dir, 'config.json');
    writeConfig({ hostId: HOST, stateDb: db, ...LOOP });
    mkdirSync(join(dir, 'bin'));
    fakeInvoak('{"whoami":{"principal":"spidersan"}}');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

describe('parseConfig', () => {
    test('accepts a host id and an absolute state path', () => {
        expect(parseConfig('{"hostId":"h","stateDb":"/x/state.db"}')).toEqual({
            hostId: 'h',
            stateDb: '/x/state.db',
        });
    });

    test.each([
        ['not json', 'nope'],
        ['an array', '[]'],
        ['no hostId', '{"stateDb":"/x"}'],
        ['empty hostId', '{"hostId":"","stateDb":"/x"}'],
        ['padded hostId', '{"hostId":" h","stateDb":"/x"}'],
        ['non-string hostId', '{"hostId":1,"stateDb":"/x"}'],
        ['no stateDb', '{"hostId":"h"}'],
        ['relative stateDb', '{"hostId":"h","stateDb":"state.db"}'],
    ])('refuses %s', (_name, text) => {
        expect(parseConfig(text)).toBeNull();
    });
});

describe('start', () => {
    const text = '{"hostId":"h","stateDb":"/x/state.db"}';
    const held = () => true;

    test('starts on the named host with the lock held', () => {
        expect(start(text, {}, 'h', held)).toEqual({
            ok: true,
            config: { hostId: 'h', stateDb: '/x/state.db' },
        });
    });

    test('asks about the lock next to the state file', () => {
        const asked: string[] = [];
        start(text, {}, 'h', (path) => (asked.push(path), true));
        expect(asked).toEqual(['/x/state.db.lock']);
    });

    test.each([
        ['no config', () => start(null, {}, 'h', held)],
        ['a bad config', () => start('{}', {}, 'h', held)],
        ['another host', () => start(text, {}, 'other', held)],
        ['no host id', () => start(text, {}, null, held)],
        ['no lock', () => start(text, {}, 'h', () => false)],
    ])('refuses with %s', (_name, attempt) => {
        expect(attempt().ok).toBe(false);
    });
});

// Real processes: the launcher, flock(2) and the entrypoint together.
describe('launcher and entrypoint', () => {
    test('this machine has a host id', () => {
        expect(HOST).not.toBeNull();
    });

    test('a launched pass reconciles and exits 0', () => {
        const done = run([LAUNCHER, config]);
        expect(done.err).toBe('');
        expect(done.exit).toBe(0);
        expect(JSON.parse(done.out)).toEqual({
            reconcile: { pending: [], unrecognised: [], held: [] },
            prs: [],
            unread: [],
        });
        expect(existsSync(db)).toBe(true);
    });

    test('no loop config: exit 78, database not created', () => {
        writeConfig({ hostId: HOST, stateDb: db });
        const done = run([LAUNCHER, config]);
        expect(done.exit).toBe(EXIT_CONFIG);
        expect(done.err).toContain('loop config');
        expect(existsSync(db)).toBe(false);
    });

    test('run without the launcher: refused, database not created', () => {
        const done = run(['bun', MAIN, config]);
        expect(done.exit).toBe(EXIT_CONFIG);
        expect(done.err).toContain('lock');
        expect(existsSync(db)).toBe(false);
    });

    test('an fd on another file does not pass for the lock, even while the lock is held', async () => {
        const holder = hold();
        try {
            await untilLocked();
            const other = openSync(join(dir, 'other'), 'a');
            const done = Bun.spawnSync(['bun', MAIN, config], {
                env: { ...process.env, SPIDERSAN_COORDINATOR_LOCK_FD: '3' },
                stdio: ['ignore', 'pipe', 'pipe', other],
            });
            expect(done.exitCode).toBe(EXIT_CONFIG);
            expect(done.stderr.toString()).toContain('lock');
            expect(existsSync(db)).toBe(false);
        } finally {
            holder.kill('SIGKILL');
            await holder.exited;
        }
    });

    test('a second open of the lock file does not pass for the lock while another process holds it', async () => {
        const holder = hold();
        try {
            await untilLocked();
            const second = openSync(`${db}.lock`, 'a');
            const done = Bun.spawnSync(['bun', MAIN, config], {
                env: { ...process.env, SPIDERSAN_COORDINATOR_LOCK_FD: '3' },
                stdio: ['ignore', 'pipe', 'pipe', second],
            });
            expect(done.exitCode).toBe(EXIT_CONFIG);
            expect(done.stderr.toString()).toContain('lock');
            expect(existsSync(db)).toBe(false);
        } finally {
            holder.kill('SIGKILL');
            await holder.exited;
        }
    });

    test('another host: refused, database not created', () => {
        writeConfig({ hostId: 'not-this-machine', stateDb: db });
        const done = run([LAUNCHER, config]);
        expect(done.exit).toBe(EXIT_CONFIG);
        expect(done.err).toContain('host');
        expect(existsSync(db)).toBe(false);
    });

    test('a config with no state path: the launcher refuses', () => {
        writeConfig({ hostId: HOST });
        expect(run([LAUNCHER, config]).exit).toBe(EXIT_CONFIG);
        expect(run([LAUNCHER, join(dir, 'missing.json')]).exit).toBe(EXIT_CONFIG);
    });

    function holderScript(): string {
        const path = join(dir, 'holder.sh');
        writeFileSync(path, 'exec sleep 30\n');
        return path;
    }

    /** The launcher holding the lock on `db` with `sleep` standing in for the coordinator. */
    function hold(): ReturnType<typeof Bun.spawn> {
        return Bun.spawn([LAUNCHER, config], {
            env: {
                ...process.env,
                SPIDERSAN_COORDINATOR_BUN: '/bin/sh',
                SPIDERSAN_COORDINATOR_MAIN: holderScript(),
            },
            stderr: 'pipe',
        });
    }

    async function untilLocked(): Promise<void> {
        for (let i = 0; i < 100; i++) {
            if (
                existsSync(`${db}.lock`) &&
                run([LAUNCHER, config], { SPIDERSAN_COORDINATOR_BUN: '/usr/bin/true' }).exit === 75
            )
                return;
            await Bun.sleep(50);
        }
        throw new Error('the holder never took the lock');
    }

    test('a second coordinator exits 75 before touching the database; SIGKILL of the holder frees the lock', async () => {
        const holder = hold();
        try {
            await untilLocked();
            const second = run([LAUNCHER, config]);
            expect(second.exit).toBe(75);
            expect(second.err).toContain('another coordinator holds');
            expect(existsSync(db)).toBe(false);
        } finally {
            holder.kill('SIGKILL');
            await holder.exited;
        }
        const next = run([LAUNCHER, config]);
        expect(next.exit).toBe(0);
        expect(existsSync(db)).toBe(true);
    });
});

describe('GitHub tokens (sp-vkqq)', () => {
    const TOKEN = 'github_pat_preflight_secret';

    test('a repo whose token is not in the environment: exit 77, nothing asked of gh, database not created', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        fakeGh();
        const done = run([LAUNCHER, config], { GH_TOKEN: 'ambient', GITHUB_TOKEN: 'ambient' });
        expect(done.exit).toBe(EXIT_CREDENTIALS);
        expect(done.err).toContain('owner/name: OWNER_PAT is not set');
        expect(existsSync(join(dir, 'gh.log'))).toBe(false);
        expect(existsSync(db)).toBe(false);
    });

    test('a token GitHub refuses: exit 77 naming the repo and the permission, never the token', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        fakeGh(403);
        const done = run([LAUNCHER, config], { OWNER_PAT: TOKEN });
        expect(done.exit).toBe(EXIT_CREDENTIALS);
        expect(done.err).toContain('owner/name: OWNER_PAT cannot read the repository (HTTP 403, GitHub asks for statuses=read)');
        expect(done.err + done.out).not.toContain(TOKEN);
        expect(existsSync(db)).toBe(false);
    });

    test('a token that passes: the pass runs, and gh got that token and no other', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        fakeGh();
        const done = run([LAUNCHER, config], {
            OWNER_PAT: TOKEN,
            GH_TOKEN: 'ambient',
            GITHUB_TOKEN: 'ambient',
            GH_HOST: 'ghe.example.com',
        });
        expect(done.err).toBe('');
        expect(done.exit).toBe(0);
        const log = readFileSync(join(dir, 'gh.log'), 'utf8').trim().split('\n');
        expect(log.length).toBeGreaterThan(5);
        expect(log.every((line) => line.startsWith(`${TOKEN}||`))).toBe(true);
        // Pinned to github.com whatever GH_HOST says (#361 P1-1): reads in the pass and the preflight alike.
        expect(log.every((line) => line.endsWith(' --hostname github.com'))).toBe(true);
        expect(log.some((line) => line.includes('|api repos/owner/name/pulls?state=open&per_page=100 '))).toBe(true);
        // dry-run writes nothing to GitHub, so its token is not asked to.
        expect(log.some((line) => line.includes('statuses/0000'))).toBe(false);
    });

    test('a probe gh was killed in after a 200 header: exit 77, database not created (#361 P1-2)', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        fakeGh();
        writeFileSync(join(dir, 'partial'), '');
        const done = run([LAUNCHER, config], { OWNER_PAT: TOKEN });
        expect(done.exit).toBe(EXIT_CREDENTIALS);
        expect(done.err).toContain('owner/name: OWNER_PAT cannot read Actions runs (gh did not finish)');
        expect(existsSync(db)).toBe(false);
    });

    test('an Actions answer of {} is no listing: exit 77, database not created (#361)', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        fakeGh();
        writeFileSync(join(dir, 'not-a-listing'), '');
        const done = run([LAUNCHER, config], { OWNER_PAT: TOKEN });
        expect(done.exit).toBe(EXIT_CREDENTIALS);
        expect(done.err).toContain('owner/name: OWNER_PAT cannot read Actions runs (HTTP 200)');
        expect(existsSync(db)).toBe(false);
    });

    test('--preflight: the check alone, writes probed too; no lock, no database', () => {
        writeConfig({ hostId: 'not-this-machine', stateDb: db, ...withRepo() });
        fakeGh();
        const done = run(['bun', MAIN, '--preflight', config], { OWNER_PAT: TOKEN });
        expect(done.exit).toBe(0);
        expect(done.out).toContain('owner/name: OWNER_PAT reads and writes statuses (dry-run, no expiry)');
        expect(readFileSync(join(dir, 'gh.log'), 'utf8')).toContain('statuses/0000');
        expect(existsSync(db)).toBe(false);
    });

    test('--preflight after the config, through the launcher: refused, no pass, no gh, no database', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        fakeGh();
        const done = run([LAUNCHER, config, '--preflight'], { OWNER_PAT: TOKEN });
        expect(done.exit).toBe(EXIT_CONFIG);
        expect(done.err).toContain('one argument, the config');
        expect(existsSync(join(dir, 'gh.log'))).toBe(false);
        expect(existsSync(db)).toBe(false);
    });

    test('--preflight: a missing token is 77, a missing config 78', () => {
        writeConfig({ hostId: HOST, stateDb: db, ...withRepo() });
        expect(run(['bun', MAIN, '--preflight', config]).exit).toBe(EXIT_CREDENTIALS);
        expect(run(['bun', MAIN, '--preflight', join(dir, 'missing.json')]).exit).toBe(EXIT_CONFIG);
        expect(run(['bun', MAIN, '--preflight']).exit).toBe(EXIT_CONFIG);
    });
});

describe('whose invoak token', () => {
    test.each([
        ['another agent', '{"whoami":{"principal":"mycsan"}}'],
        ['nobody it can name', '{"error":{"code":"NO_CREDENTIAL"}}'],
    ])('invoak acts as %s: exit 78, database not created', (_name, answer) => {
        fakeInvoak(answer);
        const done = run([LAUNCHER, config]);
        expect(done.exit).toBe(EXIT_CONFIG);
        expect(done.err).toContain('invoak whoami');
        expect(existsSync(db)).toBe(false);
    });

    test('a label is not asked for: only what invoak answers counts', () => {
        const done = run([LAUNCHER, config], { ENVOAK_AGENT_LABEL: 'mycsan' });
        expect(done.exit).toBe(0);
    });
});

describe('childEnv', () => {
    const own = {
        PATH: '/bin',
        HOME: '/h',
        ENVOAK_AGENT_LABEL: 'spidersan',
        PRSAN_SANDBOX_EXEC: '/bin/true',
        VAULT_SESSION_TOKEN: 's',
        CLAUDE_CODE_OAUTH_TOKEN: 't',
        INVOAK_OWNER_SECRET: 'o',
    };

    test('gh and invoak get their short list: no reviewer token, no owner secret (sp-sloro)', () => {
        expect(childEnv(own, undefined)).toEqual({ PATH: '/bin', HOME: '/h', ENVOAK_AGENT_LABEL: 'spidersan' });
    });

    test('a gh run gets its token, an empty config, and no ambient token, host or config (sp-vkqq, #361 P1-1)', () => {
        const ambient = {
            ...own,
            GH_TOKEN: 'ambient',
            GITHUB_TOKEN: 'ambient',
            GH_ENTERPRISE_TOKEN: 'ambient',
            GH_HOST: 'ghe.example.com',
            GH_CONFIG_DIR: '/c',
            XDG_CONFIG_HOME: '/x',
        };
        expect(childEnv(ambient, undefined, { token: 'mapped', configDir: '/private' })).toEqual({
            PATH: '/bin',
            HOME: '/h',
            ENVOAK_AGENT_LABEL: 'spidersan',
            GH_TOKEN: 'mapped',
            GH_CONFIG_DIR: '/private',
        });
        // invoak's run is unchanged.
        expect(childEnv(ambient, undefined)).toMatchObject({
            GH_TOKEN: 'ambient',
            GITHUB_TOKEN: 'ambient',
            GH_HOST: 'ghe.example.com',
            GH_CONFIG_DIR: '/c',
        });
    });

    test('a gh run really starts with only its token, no GH_HOST, and an empty private config dir', async () => {
        process.env.GITHUB_TOKEN = 'ambient';
        process.env.GH_HOST = 'ghe.example.com';
        try {
            const script = 'printf "%s|%s|%s|%s" "$GH_TOKEN" "$GITHUB_TOKEN" "$GH_HOST" "$GH_CONFIG_DIR"';
            const done = await runCommand('/bin/sh', ['-c', script], { cwd: '/', githubToken: 'mapped' });
            expect(done.stdout).toBe(`mapped|||${privateGhConfig()}`);
            expect(readdirSync(privateGhConfig())).toEqual([]);
            expect(statSync(privateGhConfig()).mode & 0o777).toBe(0o700);
        } finally {
            delete process.env.GITHUB_TOKEN;
            delete process.env.GH_HOST;
        }
    });

    test('a run with its own env gets the short list and that env, nothing else', () => {
        expect(childEnv(own, { PRSAN_ISOLATION: 'require' })).toEqual({
            PATH: '/bin',
            HOME: '/h',
            CLAUDE_CODE_OAUTH_TOKEN: 't',
            PRSAN_ISOLATION: 'require',
        });
    });

    test('a reviewer run really starts without the rest', async () => {
        process.env.PRSAN_SANDBOX_EXEC = '/bin/true';
        try {
            const done = await runCommand('/bin/sh', ['-c', 'printf "%s|%s" "$PRSAN_SANDBOX_EXEC" "$X"'], {
                cwd: '/',
                env: { X: 'y' },
            });
            expect(done.stdout).toBe('|y');
        } finally {
            delete process.env.PRSAN_SANDBOX_EXEC;
        }
    });
});

describe('runCommand', () => {
    test('stdout and the exit code; env is added; stdin is closed', async () => {
        const done = await runCommand('/bin/sh', ['-c', 'cat; printf "%s" "$X"; exit 3'], {
            cwd: '/',
            env: { X: 'y' },
        });
        expect(done).toEqual({ exitCode: 3, stdout: 'y' });
    });

    test('a timeout or a missing command has no exit code', async () => {
        expect((await runCommand('/bin/sleep', ['5'], { cwd: '/', timeoutMs: 50 })).exitCode).toBeNull();
        expect((await runCommand('/nonexistent/x', [], { cwd: '/' })).exitCode).toBeNull();
    });
});

describe('fileIo', () => {
    test('review files by prefix, with the count the directory lists', () => {
        writeFileSync(join(dir, 'owner_name-7-aaaaaaa-r1-luna.md'), 'one');
        writeFileSync(join(dir, 'owner_name-70-aaaaaaa-r1-luna.md'), 'other PR');
        writeFileSync(join(dir, 'owner_name-7-aaaaaaa-r1-luna.diff'), 'not a review');
        expect(fileIo(dir).reviewFiles('owner_name-7-')).toEqual({
            files: [{ name: 'owner_name-7-aaaaaaa-r1-luna.md', text: 'one' }],
            expectedCount: 1,
        });
    });

    test('a file too large to read leaves the listing short', () => {
        writeFileSync(join(dir, 'owner_name-7-aaaaaaa-r1-luna.md'), 'x'.repeat(1024 * 1024 + 1));
        expect(fileIo(dir).reviewFiles('owner_name-7-')).toEqual({ files: [], expectedCount: 1 });
    });

    test('a FIFO with a review file name is not opened: the listing is short', () => {
        // Reading it would block for good, with the coordinator's lock held.
        execFileSync('/usr/bin/mkfifo', [join(dir, 'owner_name-7-aaaaaaa-r1-luna.md')]);
        expect(fileIo(dir).reviewFiles('owner_name-7-')).toEqual({ files: [], expectedCount: 1 });
    });

    test('a directory that cannot be listed is not an empty one', () => {
        expect(fileIo(join(dir, 'missing')).reviewFiles('owner_name-7-')).toEqual({ files: [], expectedCount: -1 });
    });

    test('the diff file exists while it is used and is gone after', async () => {
        const path = await fileIo(dir).withDiffFile('the diff', async (p) => {
            expect(readFileSync(p, 'utf8')).toBe('the diff');
            return p;
        });
        expect(existsSync(path)).toBe(false);
    });
});
