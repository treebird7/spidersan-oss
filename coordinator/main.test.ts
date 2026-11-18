import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { EXIT_CONFIG, parseConfig, readHostId, start } from './main';

const LAUNCHER = resolve(import.meta.dir, 'spidersan-coordinator');
const MAIN = resolve(import.meta.dir, 'main.ts');
const HOST = readHostId();

let dir: string;
let db: string;
let config: string;

function writeConfig(value: unknown): void {
    writeFileSync(config, JSON.stringify(value));
}

function run(command: string[], env: Record<string, string> = {}) {
    const done = Bun.spawnSync(command, {
        env: { ...process.env, ...env },
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
    writeConfig({ hostId: HOST, stateDb: db });
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
        });
        expect(existsSync(db)).toBe(true);
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
