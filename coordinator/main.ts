/// <reference types="node" />
/**
 * PR coordinator — the entrypoint (slice 4 of 4, part 1: start-up guards).
 *
 * Run through `coordinator/spidersan-coordinator <config.json>`, which takes the
 * process lock and then execs this file. Before the database is opened:
 *
 *   1. the config parses and names a host id and an absolute state path;
 *   2. this machine is the host the config names (state is local, so exactly
 *      one host may run the coordinator);
 *   3. this process holds the lock on `<stateDb>.lock`.
 *
 * Any of the three failing is exit 78 with the database untouched. Then one
 * reconcile pass runs. This part has no adapter that talks to GitHub or
 * invoak: every read answers `unknown` and every write is recorded only, so
 * the pass resolves nothing and performs nothing. The PR loop is part 2.
 */

import { execFileSync } from 'node:child_process';
import { fstatSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DryRunEffects } from './effects';
import type { EffectReader } from './effects';
import { Actions } from './reconcile';
import { State } from './state';

export const EXIT_CONFIG = 78;
const PROBE_TIMEOUT_MS = 10_000;

export interface Config {
    /** The one machine allowed to run the coordinator: what `--host-id` prints there. */
    hostId: string;
    /** Absolute path of the SQLite state file. The lock is `<stateDb>.lock`. */
    stateDb: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The config in `text`, or null when it is not JSON with a non-empty `hostId` and an absolute `stateDb`. */
export function parseConfig(text: string): Config | null {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        return null;
    }
    if (!isRecord(raw)) return null;
    const { hostId, stateDb } = raw;
    if (typeof hostId !== 'string' || hostId.trim() === '' || hostId !== hostId.trim()) return null;
    if (typeof stateDb !== 'string' || !isAbsolute(stateDb)) return null;
    return { hostId, stateDb };
}

/**
 * A stable id for this machine, or null when there is none to read. Not the
 * hostname: two fleet Macs both answer `MacBook-Pro.local`.
 */
export function readHostId(platform: string = process.platform): string | null {
    try {
        if (platform === 'darwin') {
            const out = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
                encoding: 'utf8',
                timeout: PROBE_TIMEOUT_MS,
            });
            return /"IOPlatformUUID" = "([0-9A-Fa-f-]{36})"/.exec(out)?.[1] ?? null;
        }
        if (platform === 'linux') return readFileSync('/etc/machine-id', 'utf8').trim() || null;
    } catch {
        // fall through: no id
    }
    return null;
}

const RELOCK = 'open(my $f, ">>&=", 3) or exit 2; exit(flock($f, LOCK_EX | LOCK_NB) ? 0 : 1)';

/**
 * Does this process hold the lock on `lockPath`? True only when the fd the
 * launcher passed is open on that file, and locking that
 * same open file succeeds. flock(2) belongs to the open file: asking again on
 * the one that holds the lock succeeds, and on any other one it is refused
 * while the lock is held. Anything else (no perl, a timeout) is "no".
 */
export function holdsLock(lockPath: string, env: Record<string, string | undefined>): boolean {
    const fd = Number(env.SPIDERSAN_COORDINATOR_LOCK_FD);
    if (!Number.isInteger(fd) || fd < 3) return false;
    try {
        const ours = fstatSync(fd);
        const file = statSync(lockPath);
        if (ours.ino !== file.ino || ours.dev !== file.dev) return false;
        execFileSync('/usr/bin/perl', ['-MFcntl=:flock', '-e', RELOCK], {
            timeout: PROBE_TIMEOUT_MS,
            stdio: ['ignore', 'ignore', 'ignore', fd],
        });
        return true;
    } catch {
        return false;
    }
}

export type Start = { ok: true; config: Config } | { ok: false; why: string };

/** The three start-up guards. Opens nothing. */
export function start(
    configText: string | null,
    env: Record<string, string | undefined>,
    hostId: string | null = readHostId(),
    locked: (lockPath: string, env: Record<string, string | undefined>) => boolean = holdsLock,
): Start {
    const config = configText === null ? null : parseConfig(configText);
    if (config === null)
        return {
            ok: false,
            why: 'config is missing, or lacks "hostId" or an absolute "stateDb"',
        };
    if (hostId === null) return { ok: false, why: 'this machine has no readable host id' };
    if (hostId !== config.hostId) return { ok: false, why: 'this machine is not the host the config names' };
    if (!locked(`${config.stateDb}.lock`, env)) {
        return {
            ok: false,
            why: `the lock on ${config.stateDb}.lock is not held by this process: run coordinator/spidersan-coordinator`,
        };
    }
    return { ok: true, config };
}

const UNKNOWN = { kind: 'unknown' } as const;

/** Part 1 has no real reader: nothing is known about the outside world. */
const NO_READER: EffectReader = {
    readPr: async () => UNKNOWN,
    readGate: async () => UNKNOWN,
    readRegistryRow: async () => UNKNOWN,
    findDelivery: async () => UNKNOWN,
    findEscalation: async () => UNKNOWN,
    readApproval: async () => UNKNOWN,
};

async function main(argv: string[]): Promise<number> {
    if (argv[0] === '--host-id') {
        const id = readHostId();
        if (id === null) return EXIT_CONFIG;
        console.log(id);
        return 0;
    }
    let text: string | null = null;
    try {
        if (argv[0] !== undefined) text = readFileSync(argv[0], 'utf8');
    } catch {
        // start() reports it
    }
    const started = start(text, process.env);
    if (!started.ok) {
        console.error(`coordinator: refusing to start: ${started.why}`);
        return EXIT_CONFIG;
    }
    const state = new State(started.config.stateDb);
    try {
        const report = await new Actions(state, new DryRunEffects(NO_READER)).reconcile(Date.now());
        console.log(JSON.stringify({ reconcile: report }));
    } finally {
        state.close();
    }
    return 0;
}

declare global {
    /** Bun: true in the file that was run. `types: []` leaves it undeclared. */
    interface ImportMeta {
        readonly main: boolean;
    }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
