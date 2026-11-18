import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXIT_CONFIG, actsAs, childEnv, fileIo, parseConfig, readHostId, runCommand, start } from './main';

const LAUNCHER = resolve(import.meta.dir, 'spidersan-coordinator');
const MAIN = resolve(import.meta.dir, 'main.ts');
const HOST = readHostId();

/** The loop's part of the config, with no repos: reconcile, then a pass over nothing. */
const LOOP = {
    self: 'spidersan',
    owner: 'treebird',
    escalationProject: 'sp',
    maxReviewsPerPass: 10,
    prsan: {
        home: '/nonexistent/prsan',
        timeoutMs: 1000,
        models: { luna: 'luna', terra: 'terra', sol: 'sol' },
        families: {},
    },
    repos: {},
};

let dir: string;
let db: string;
let config: string;

function writeConfig(value: unknown): void {
    writeFileSync(config, JSON.stringify(value));
}

function run(command: string[], env: Record<string, string> = {}) {
    const done = Bun.spawnSync(command, {
        env: { ...process.env, ENVOAK_AGENT_LABEL: 'spidersan', ...env },
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

describe('whose invoak token', () => {
    test('the label is the coordinator, or the coordinator on a machine', () => {
        expect(actsAs('spidersan', 'spidersan')).toBe(true);
        expect(actsAs('spidersan', 'spidersan-m5')).toBe(true);
        expect(actsAs('spidersan', undefined)).toBe(false);
        expect(actsAs('spidersan', '')).toBe(false);
        expect(actsAs('spidersan', 'mycsan')).toBe(false);
        expect(actsAs('spidersan', 'spidersanx')).toBe(false);
    });

    test.each([
        ['no label', ''],
        ["another agent's label", 'mycsan'],
    ])('%s: exit 78, database not created', (_name, label) => {
        const done = run([LAUNCHER, config], { ENVOAK_AGENT_LABEL: label });
        expect(done.exit).toBe(EXIT_CONFIG);
        expect(done.err).toContain('ENVOAK_AGENT_LABEL');
        expect(existsSync(db)).toBe(false);
    });
});

describe('childEnv', () => {
    const own = {
        PATH: '/bin',
        HOME: '/h',
        ENVOAK_AGENT_LABEL: 'spidersan',
        PRSAN_SANDBOX_EXEC: '/bin/true',
        VAULT_SESSION_TOKEN: 's',
    };

    test("gh and invoak get the coordinator's environment", () => {
        expect(childEnv(own, undefined)).toEqual(own);
    });

    test('a run with its own env gets the short list and that env, nothing else', () => {
        expect(childEnv(own, { PRSAN_ISOLATION: 'require' })).toEqual({
            PATH: '/bin',
            HOME: '/h',
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
