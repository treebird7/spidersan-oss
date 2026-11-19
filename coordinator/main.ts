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
 * Any of the three failing, or a loop config that does not parse (`config.ts`),
 * is exit 78 with the database untouched. Then one reconcile pass runs, and
 * one pass of the PR loop (`loop.ts`).
 *
 * Reads go to GitHub and invoak. Notes and escalations are really delivered;
 * a merge or a gate reset is recorded only (`NotifyingDryRunEffects`). Not
 * read yet: the gate status, registry rows and approvals (invk-fosip).
 */

import { execFile, execFileSync } from 'node:child_process';
import { fstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { parseLoopConfig } from './config';
import type { LoopConfig } from './config';
import { NotifyingDryRunEffects } from './effects';
import type { EffectReader } from './effects';
import { GitHub } from './github';
import { Invoak, invoakPrincipal } from './invoak';
import { pass } from './loop';
import type { Io } from './loop';
import type { CommandRunner, ReviewFile } from './readers';
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
const RUN_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 64 * 1024 * 1024;
/** A review file larger than this is not read, so its listing is short and the PR is held. */
const MAX_REVIEW_FILE = 1024 * 1024;

/**
 * What a run that names its own `env` inherits, and nothing else. Such a run
 * reads a pull request (triage, prsan): it gets no vault or agent variable, and
 * no `PRSAN_*` setting from whoever started the coordinator, which could
 * switch its sandbox off.
 */
const REVIEWER_ENV = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'CLAUDE_CODE_OAUTH_TOKEN',
    'GH_TOKEN',
    'PI_AUTH_FILE',
    'PI_CODING_AGENT_DIR',
    'XDG_CACHE_HOME',
] as const;

/**
 * What `gh` and `invoak` read (invoak's names from its binary, 2026-11-19). Not the reviewer
 * token: under `envoak vault inject` the coordinator holds CLAUDE_CODE_OAUTH_TOKEN, and only
 * triage and prsan need it (sp-sloro). Nor INVOAK_OWNER_SECRET: the coordinator acts as an agent.
 */
const CLI_ENV = [
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'XDG_CONFIG_HOME',
    'GH_TOKEN',
    'GITHUB_TOKEN',
    'GH_HOST',
    'GH_CONFIG_DIR',
    'ENVOAK_AGENT_LABEL',
    'ENVOAK_BROKER_SOCK',
    'INVOAK_API_URL',
    'INVOAK_TOKEN',
] as const;

/** The environment of one run: CLI_ENV for `gh` and `invoak`, REVIEWER_ENV plus `env` for a run that brings its own. */
export function childEnv(
    own: Record<string, string | undefined>,
    extra: Readonly<Record<string, string>> | undefined,
): Record<string, string | undefined> {
    const env: Record<string, string | undefined> = {};
    const names = extra === undefined ? CLI_ENV : REVIEWER_ENV;
    for (const name of names) if (own[name] !== undefined) env[name] = own[name];
    return { ...env, ...extra };
}

/** Runs an argv (never a shell string) with stdin closed. A kill, a timeout or too much output is `exitCode: null`. */
export const runCommand: CommandRunner = (command, argv, options) =>
    new Promise((resolve) => {
        const child = execFile(
            command,
            [...argv],
            {
                cwd: options.cwd,
                env: childEnv(process.env, options.env),
                timeout: options.timeoutMs ?? RUN_TIMEOUT_MS,
                maxBuffer: MAX_OUTPUT,
                encoding: 'utf8',
            },
            (error, stdout) => {
                const code: unknown = error === null ? 0 : error.code;
                resolve({ exitCode: typeof code === 'number' ? code : null, stdout });
            },
        );
        child.stdin?.end();
    });

/** prsan's `reviews/` directory and a private temp file for a diff. */
export function fileIo(reviewsDir: string): Io {
    return {
        reviewFiles(prefix) {
            let names: string[];
            try {
                names = readdirSync(reviewsDir).filter((name) => name.startsWith(prefix) && name.endsWith('.md'));
            } catch {
                return { files: [], expectedCount: -1 };
            }
            const files: ReviewFile[] = [];
            for (const name of names) {
                try {
                    const path = join(reviewsDir, name);
                    // A regular file only: reading a FIFO of that name would block with the lock held.
                    const stat = statSync(path);
                    if (stat.isFile() && stat.size <= MAX_REVIEW_FILE)
                        files.push({ name, text: readFileSync(path, 'utf8') });
                } catch {
                    // left out: the count no longer matches, and the reader holds the PR
                }
            }
            return { files, expectedCount: names.length };
        },
        async withDiffFile(text, use) {
            const dir = mkdtempSync(join(tmpdir(), 'coordinator-diff-'));
            try {
                const path = join(dir, 'pr.diff');
                writeFileSync(path, text, { mode: 0o600 });
                return await use(path);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        },
    };
}

async function wake(config: Config, loop: LoopConfig): Promise<unknown> {
    const github = new GitHub(runCommand);
    const state = new State(config.stateDb);
    try {
        const invoak = new Invoak(runCommand, {
            self: loop.self,
            project: loop.escalationProject,
            owner: loop.owner,
            secret: state.secret(),
        });
        const reader: EffectReader = {
            readPr: (ref) => github.readPr(ref),
            readGate: async () => UNKNOWN,
            readRegistryRow: async () => UNKNOWN,
            findDelivery: (query) => invoak.findDelivery(query),
            findEscalation: (query) => invoak.findEscalation(query),
            readApproval: async () => ({ kind: 'unverified' }),
        };
        const actions = new Actions(state, new NotifyingDryRunEffects(reader, invoak), loop.owner);
        const reconcile = await actions.reconcile(Date.now());
        const prs = await pass(
            {
                github,
                tasks: invoak,
                run: runCommand,
                io: fileIo(join(loop.prsan.home, 'reviews')),
                state,
                actions,
                now: Date.now,
            },
            loop,
        );
        return { reconcile, ...prs };
    } finally {
        state.close();
    }
}

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
    const loop = text === null ? null : parseLoopConfig(text);
    if (loop === null) {
        console.error(
            'coordinator: refusing to start: the loop config is missing or malformed (see coordinator/config.ts)',
        );
        return EXIT_CONFIG;
    }
    // Asked of invoak itself, with the credential the writes will use. A label proves nothing:
    // with none set, invoak borrows whatever token ~/.invoak/.env holds.
    if ((await invoakPrincipal(runCommand)) !== loop.self) {
        console.error(`coordinator: refusing to start: invoak does not act as ${loop.self} (invoak whoami)`);
        return EXIT_CONFIG;
    }
    console.log(JSON.stringify(await wake(started.config, loop)));
    return 0;
}

declare global {
    /** Bun: true in the file that was run. `types: []` leaves it undeclared. */
    interface ImportMeta {
        readonly main: boolean;
    }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
