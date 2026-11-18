/**
 * PR coordinator — the state layer (slice 3 of 4).
 *
 * One SQLite file (`bun:sqlite`) holding what the coordinator did: intents,
 * the attempt ledger, delivery receipts and escalations. Every sha is a full
 * 40-char sha. All SQL in the coordinator lives in this file, every statement
 * is parameterised, and every multi-row write is one transaction.
 *
 * Not held here: release records and umbrella executions (no table yet).
 *
 * An intent is one external effect:
 *
 *   queued ──▶ pending ──▶ done              the effect happened (receipt / merge commit kept)
 *      │             ├──▶ rolled-back        a call was made and the effect did not happen
 *      │             ├──▶ dry-run            a record-only adapter took it; nothing happened
 *      │             └──▶ merged-elsewhere   merge only: the PR is merged at another head than
 *      │                                     this intent's; that head and commit are kept
 *      └──▶ unsent                           no call was made; says nothing about the PR
 *
 * A merge intent for which any read has said `merged` is never `rolled-back`:
 * the update itself refuses it.
 *
 * Asking again for a `rolled-back` intent writes a new row. Asking again for a
 * `dry-run` one reopens the same row, so a dry-run repo keeps one row per
 * intent however many wakes ask for it, and a later live adapter still sends.
 *
 * `queued` = no call has been started. `pending` = a call may have been sent
 * and its result is not recorded; only the reconcile pass may resolve it. The
 * clock is passed in (`now`, epoch ms); nothing here reads one.
 */

import { Database } from 'bun:sqlite';
import { isFullSha } from './decide';
import type { Attempt, BlockingNote } from './types';

/** 2: `intents.merged_head` and `intents.seen_merged`. A file at another version is refused, not migrated. */
export const SCHEMA_VERSION = 2;

export const INTENT_KINDS = ['merge', 'gate-reset', 'note', 'landed-note', 'escalation'] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];

export const INTENT_STATES = [
    'queued',
    'pending',
    'done',
    'rolled-back',
    'dry-run',
    'unsent',
    'merged-elsewhere',
] as const;
export type IntentState = (typeof INTENT_STATES)[number];

/** States in which a row is finished and takes no further part in a wake. */
const SETTLED = ['done', 'rolled-back', 'dry-run', 'unsent', 'merged-elsewhere'] as const;

export interface Intent {
    /** Stable and derived from what the intent is about; doubles as the action id. */
    id: string;
    kind: IntentKind;
    repo: string;
    pr: number;
    head: string;
    /** merge only: the base the evidence was gathered against. */
    base: string | null;
    state: IntentState;
    /** note: the notify reason. escalation: the escalation reason. Else ''. */
    reason: string;
    /** The invoak task a note goes to. merge carries it for its landed note. */
    taskId: string | null;
    /** escalation only: who it is addressed to. */
    addressee: string | null;
    /** note, landed-note, escalation: the text to deliver, without the action id. */
    body: string | null;
    /** merge, once done or merged-elsewhere: the merge commit on the base branch. */
    mergeCommit: string | null;
    /** merge, merged-elsewhere only: the head the PR was merged at. */
    mergedHead: string | null;
    /** merge only: some read has said this PR is merged. Never unset. */
    seenMerged: boolean;
    createdAt: number;
    updatedAt: number;
}

export type NewIntent = Pick<Intent, 'kind' | 'repo' | 'pr' | 'head' | 'base' | 'reason' | 'taskId' | 'addressee' | 'body'>;

/** An open row this code cannot read as an intent. `pr` and `head` are as stored, unchecked. */
export interface UnrecognisedRow {
    id: string;
    repo: string;
    pr: unknown;
    head: unknown;
}

/** One paid run to reserve budget for. */
export interface Reservation {
    repo: string;
    pr: number;
    head: string;
    /** What is being paid for: `triage`, a review variant, `verify` … */
    run: string;
    reservation: number;
}

const COLUMNS =
    'id, kind, repo, pr, head, base, state, reason, task_id AS taskId, addressee, body, ' +
    'merge_commit AS mergeCommit, merged_head AS mergedHead, seen_merged AS seenMerged, ' +
    'created_at AS createdAt, updated_at AS updatedAt';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS intents (
    id           TEXT PRIMARY KEY,
    dedupe_key   TEXT NOT NULL,
    kind         TEXT NOT NULL,
    repo         TEXT NOT NULL,
    pr           INTEGER NOT NULL,
    head         TEXT NOT NULL CHECK (length(head) = 40),
    base         TEXT CHECK (base IS NULL OR length(base) = 40),
    state        TEXT NOT NULL,
    reason       TEXT NOT NULL,
    task_id      TEXT,
    addressee    TEXT,
    body         TEXT,
    merge_commit TEXT CHECK (merge_commit IS NULL OR length(merge_commit) = 40),
    merged_head  TEXT CHECK (merged_head IS NULL OR length(merged_head) = 40),
    seen_merged  INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS intents_dedupe ON intents (dedupe_key);
CREATE TABLE IF NOT EXISTS attempts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    repo        TEXT NOT NULL,
    pr          INTEGER NOT NULL,
    head        TEXT NOT NULL CHECK (length(head) = 40),
    run         TEXT NOT NULL,
    reservation REAL NOT NULL CHECK (reservation > 0),
    logged_cost REAL CHECK (logged_cost IS NULL OR logged_cost >= 0),
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS triage (
    repo   TEXT NOT NULL,
    pr     INTEGER NOT NULL,
    head   TEXT NOT NULL CHECK (length(head) = 40),
    stdout TEXT NOT NULL,
    at     INTEGER NOT NULL,
    PRIMARY KEY (repo, pr, head)
);
CREATE TABLE IF NOT EXISTS receipts (
    intent_id TEXT PRIMARY KEY REFERENCES intents (id),
    receipt   TEXT NOT NULL,
    at        INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS escalations (
    repo       TEXT NOT NULL,
    pr         INTEGER NOT NULL,
    head       TEXT NOT NULL CHECK (length(head) = 40),
    reason     TEXT NOT NULL,
    addressee  TEXT NOT NULL,
    intent_id  TEXT NOT NULL REFERENCES intents (id),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (repo, pr, head, reason)
);
`;

// ── Row checks ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isOneOf<T extends readonly string[]>(set: T, value: unknown): value is T[number] {
    return typeof value === 'string' && set.includes(value);
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isAmount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * An intent, if every field is what its kind needs; else null. Used on the way
 * in (a bad intent is never written) and on the way out (a row this code does
 * not recognise is never acted on).
 */
function parseIntent(row: unknown): Intent | null {
    if (!isRecord(row)) return null;
    const { id, kind, repo, pr, head, base, state, reason, taskId, addressee, body, mergeCommit, mergedHead } = row;
    const { createdAt, updatedAt } = row;
    if (row.seenMerged !== 0 && row.seenMerged !== 1 && typeof row.seenMerged !== 'boolean') return null;
    const seenMerged = row.seenMerged === 1 || row.seenMerged === true;
    if (!isText(id) || !isOneOf(INTENT_KINDS, kind) || !isOneOf(INTENT_STATES, state)) return null;
    if (!isText(repo) || !isCount(pr) || pr < 1 || !isFullSha(head)) return null;
    if (base !== null && !isFullSha(base)) return null;
    if (typeof reason !== 'string') return null;
    if (taskId !== null && !isText(taskId)) return null;
    if (addressee !== null && !isText(addressee)) return null;
    if (body !== null && !isText(body)) return null;
    if (mergeCommit !== null && !isFullSha(mergeCommit)) return null;
    if (mergedHead !== null && !isFullSha(mergedHead)) return null;
    if (kind !== 'merge' && (mergeCommit !== null || mergedHead !== null || seenMerged)) return null;
    if (!isCount(createdAt) || !isCount(updatedAt)) return null;
    switch (kind) {
        case 'merge':
            if (base === null || taskId === null) return null;
            if ((state === 'done' || state === 'merged-elsewhere') !== (mergeCommit !== null)) return null;
            if ((state === 'merged-elsewhere') !== (mergedHead !== null) || mergedHead === head) return null;
            if (state === 'rolled-back' && seenMerged) return null;
            break;
        case 'gate-reset':
            break;
        case 'note':
            if (taskId === null || body === null || reason === '') return null;
            break;
        case 'landed-note':
            if (taskId === null || body === null) return null;
            break;
        case 'escalation':
            if (addressee === null || body === null || reason === '') return null;
            break;
        default:
            kind satisfies never;
            return null;
    }
    return {
        id,
        kind,
        repo,
        pr,
        head,
        base,
        state,
        reason,
        taskId,
        addressee,
        body,
        mergeCommit,
        mergedHead,
        seenMerged,
        createdAt,
        updatedAt,
    };
}

function dedupeKey(spec: NewIntent): string {
    const about = `${spec.kind}:${spec.repo}#${spec.pr}@${spec.head}`;
    return spec.reason === '' ? about : `${about}:${spec.reason}`;
}

/**
 * Is this row history only, so that a new row may stand for the same key? A
 * rolled-back or unsent row records that nothing happened. A finished gate
 * reset says nothing about a later stale status on the same head.
 */
function isHistory(kind: IntentKind, state: unknown): boolean {
    return state === 'rolled-back' || state === 'unsent' || (kind === 'gate-reset' && state === 'done');
}

// ── State ──────────────────────────────────────────────────────────────────

export class State {
    readonly #db: Database;

    /** Opens (and if needed creates) the database. Refuses a file with another schema version. */
    constructor(path: string) {
        this.#db = new Database(path);
        this.#db.transaction(() => {
            this.#db.exec(SCHEMA);
            this.#db
                .query('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING')
                .run('schema_version', String(SCHEMA_VERSION));
        })();
        const row = this.#db.query('SELECT value FROM meta WHERE key = ?').get('schema_version');
        if (!isRecord(row) || row.value !== String(SCHEMA_VERSION)) {
            this.#db.close();
            throw new Error(`coordinator state: unsupported schema version in ${path}`);
        }
    }

    close(): void {
        this.#db.close();
    }

    // ── Intents ────────────────────────────────────────────────────────────

    /**
     * The intent for `spec`: the existing row when one already stands for it
     * (`created: false`), else a `queued` row (`created: true`): a new one, or
     * the same row reopened when it was only ever recorded by a dry run.
     * Throws on a malformed spec.
     */
    queue(spec: NewIntent, now: number): { intent: Intent; created: boolean } {
        return this.#db.transaction(() => this.#queue(spec, now))();
    }

    #queue(spec: NewIntent, now: number): { intent: Intent; created: boolean } {
        const key = dedupeKey(spec);
        const rows = this.#db.query(`SELECT ${COLUMNS} FROM intents WHERE dedupe_key = ? ORDER BY rowid`).all(key);
        for (const row of rows) {
            if (isHistory(spec.kind, isRecord(row) ? row.state : undefined)) continue;
            const standing = parseIntent(row);
            if (standing === null) throw new Error(`coordinator state: unrecognised intent row for ${key}`);
            if (standing.state !== 'dry-run') return { intent: standing, created: false };
            if (!isCount(now)) throw new TypeError('coordinator state: invalid clock');
            this.#db
                .query("UPDATE intents SET state = 'queued', updated_at = ? WHERE id = ? AND state = 'dry-run'")
                .run(now, standing.id);
            return { intent: { ...standing, state: 'queued', updatedAt: now }, created: true };
        }
        const intent = parseIntent({
            ...spec,
            id: `${key}:${rows.length + 1}`,
            state: 'queued',
            mergeCommit: null,
            mergedHead: null,
            seenMerged: false,
            createdAt: now,
            updatedAt: now,
        });
        if (intent === null) throw new TypeError(`coordinator state: invalid intent ${key}`);
        this.#db
            .query(
                'INSERT INTO intents (id, dedupe_key, kind, repo, pr, head, base, state, reason, task_id, addressee, ' +
                    'body, merge_commit, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            .run(
                intent.id,
                key,
                intent.kind,
                intent.repo,
                intent.pr,
                intent.head,
                intent.base,
                intent.state,
                intent.reason,
                intent.taskId,
                intent.addressee,
                intent.body,
                null,
                now,
                now,
            );
        return { intent, created: true };
    }

    /**
     * Moves an open intent to `to`. Throws when the row is not open (queued or
     * pending), and when `to` is `rolled-back` for a merge some read has seen merged.
     */
    #settle(
        id: string,
        to: IntentState,
        now: number,
        merged: { commit: string; head: string | null } | null = null,
    ): void {
        if (!isCount(now)) throw new TypeError('coordinator state: invalid clock');
        const done = this.#db
            .query(
                'UPDATE intents SET state = ?, merge_commit = ?, merged_head = ?, updated_at = ? ' +
                    "WHERE id = ? AND state IN ('queued', 'pending') AND (? <> 'rolled-back' OR seen_merged = 0)",
            )
            .run(to, merged?.commit ?? null, merged?.head ?? null, now, id, to);
        if (done.changes !== 1) throw new Error(`coordinator state: intent ${id} is not open, or was seen merged`);
    }

    /**
     * The write-ahead step: marks the intent `pending` and commits, before the
     * external call it describes is made.
     */
    begin(id: string, now: number): void {
        this.#settle(id, 'pending', now);
    }

    /** No call was made (`unsent`), or a record-only adapter took it (`dry-run`). */
    drop(id: string, to: 'unsent' | 'dry-run', now: number): void {
        this.#settle(id, to, now);
    }

    /** A read said this merge's PR is merged. From here on the intent cannot be rolled back. */
    markMergedSeen(id: string): void {
        const done = this.#db
            .query("UPDATE intents SET seen_merged = 1 WHERE id = ? AND kind = 'merge' AND state IN ('queued', 'pending')")
            .run(id);
        if (done.changes !== 1) throw new Error(`coordinator state: merge ${id} is not open`);
    }

    /**
     * The PR is merged at another head than this intent's. Keeps the head and
     * commit that were observed, and queues a gate reset for the intent's own
     * head. No landed note: this intent's merge is not what landed.
     */
    settleMergedElsewhere(id: string, observed: { mergedHead: string; mergeCommit: string }, now: number): void {
        this.#db.transaction(() => {
            const intent = this.intent(id);
            if (
                intent === null ||
                intent.kind !== 'merge' ||
                !isFullSha(observed.mergedHead) ||
                !isFullSha(observed.mergeCommit) ||
                observed.mergedHead === intent.head
            ) {
                throw new Error(`coordinator state: cannot settle ${id} as merged elsewhere`);
            }
            this.#settle(id, 'merged-elsewhere', now, { commit: observed.mergeCommit, head: observed.mergedHead });
            this.#queue(
                {
                    kind: 'gate-reset',
                    repo: intent.repo,
                    pr: intent.pr,
                    head: intent.head,
                    base: null,
                    reason: '',
                    taskId: null,
                    addressee: null,
                    body: null,
                },
                now,
            );
        })();
    }

    /** An effect with no receipt (a gate reset) is done. */
    finish(id: string, now: number): void {
        this.#settle(id, 'done', now);
    }

    /**
     * The merge happened: records the squash commit and queues the landed note
     * (and a gate reset when the gate may still read `success`), in one transaction.
     */
    finishMerge(id: string, merged: { mergeCommit: string; gateReset: boolean; landedBody: string }, now: number): void {
        this.#db.transaction(() => {
            const intent = this.intent(id);
            if (intent === null || intent.kind !== 'merge' || !isFullSha(merged.mergeCommit)) {
                throw new Error(`coordinator state: cannot finish merge ${id}`);
            }
            this.#settle(id, 'done', now, { commit: merged.mergeCommit, head: null });
            const about = { repo: intent.repo, pr: intent.pr, head: intent.head, base: null, reason: '', addressee: null };
            this.#queue({ ...about, kind: 'landed-note', taskId: intent.taskId, body: merged.landedBody }, now);
            if (merged.gateReset) this.#queue({ ...about, kind: 'gate-reset', taskId: null, body: null }, now);
        })();
    }

    /**
     * A merge call was made and the PR is not merged: rolls the intent back and
     * queues a gate reset for its head. Refused once any read has said `merged`.
     */
    rollBackMerge(id: string, now: number): void {
        this.#db.transaction(() => {
            const intent = this.intent(id);
            if (intent === null || intent.kind !== 'merge') throw new Error(`coordinator state: cannot roll back ${id}`);
            this.#settle(id, 'rolled-back', now);
            this.#queue(
                {
                    kind: 'gate-reset',
                    repo: intent.repo,
                    pr: intent.pr,
                    head: intent.head,
                    base: null,
                    reason: '',
                    taskId: null,
                    addressee: null,
                    body: null,
                },
                now,
            );
        })();
    }

    /** A delivery happened: keeps its receipt and marks the intent done. */
    recordReceipt(id: string, receipt: string, now: number): void {
        if (!isText(receipt)) throw new TypeError(`coordinator state: empty receipt for ${id}`);
        this.#db.transaction(() => {
            this.#settle(id, 'done', now);
            this.#db.query('INSERT INTO receipts (intent_id, receipt, at) VALUES (?, ?, ?)').run(id, receipt, now);
        })();
    }

    receipt(id: string): string | null {
        const row = this.#db.query('SELECT receipt FROM receipts WHERE intent_id = ?').get(id);
        return isRecord(row) && isText(row.receipt) ? row.receipt : null;
    }

    /**
     * The escalation for `(repo, pr, head, reason)`: one row per key, with the
     * intent that delivers it.
     */
    escalation(
        spec: { repo: string; pr: number; head: string; reason: string; to: string; body: string },
        now: number,
    ): { intent: Intent; created: boolean } {
        return this.#db.transaction(() => {
            const queued = this.#queue(
                {
                    kind: 'escalation',
                    repo: spec.repo,
                    pr: spec.pr,
                    head: spec.head,
                    base: null,
                    reason: spec.reason,
                    taskId: null,
                    addressee: spec.to,
                    body: spec.body,
                },
                now,
            );
            this.#db
                .query(
                    'INSERT INTO escalations (repo, pr, head, reason, addressee, intent_id, created_at) ' +
                        'VALUES (?, ?, ?, ?, ?, ?, ?) ' +
                        'ON CONFLICT (repo, pr, head, reason) DO UPDATE SET intent_id = excluded.intent_id',
                )
                .run(spec.repo, spec.pr, spec.head, spec.reason, queued.intent.addressee, queued.intent.id, now);
            return queued;
        })();
    }

    /** The intent with this id; null when there is none or the row is not recognised. */
    intent(id: string): Intent | null {
        return parseIntent(this.#db.query(`SELECT ${COLUMNS} FROM intents WHERE id = ?`).get(id));
    }

    /**
     * Every row that is not settled, oldest first: the ones this code
     * recognises, and what can be read of the ones it does not.
     */
    openIntents(): { open: Intent[]; unrecognised: UnrecognisedRow[] } {
        const rows = this.#db
            .query(`SELECT ${COLUMNS} FROM intents WHERE state NOT IN (${SETTLED.map(() => '?').join(', ')}) ORDER BY rowid`)
            .all(...SETTLED);
        const open: Intent[] = [];
        const unrecognised: UnrecognisedRow[] = [];
        for (const row of rows) {
            const intent = parseIntent(row);
            if (intent !== null) open.push(intent);
            else if (isRecord(row)) {
                unrecognised.push({ id: String(row.id), repo: String(row.repo), pr: row.pr, head: row.head });
            }
        }
        return { open, unrecognised };
    }

    /**
     * Repos in which nothing may be merged: one with an unresolved merge or
     * gate reset, or with a row this code does not recognise.
     */
    heldRepos(): string[] {
        const { open, unrecognised } = this.openIntents();
        const held = new Set(unrecognised.map((row) => row.repo));
        for (const intent of open) {
            if (intent.kind === 'merge' || intent.kind === 'gate-reset') held.add(intent.repo);
        }
        return [...held];
    }

    isHeld(repo: string): boolean {
        return this.heldRepos().includes(repo);
    }

    // ── Attempt ledger ─────────────────────────────────────────────────────

    /** Reserves budget for one paid run, before the run. Returns the attempt id. */
    reserve(run: Reservation, now: number): number {
        if (!isText(run.repo) || !isCount(run.pr) || run.pr < 1 || !isFullSha(run.head) || !isText(run.run)) {
            throw new TypeError('coordinator state: invalid reservation');
        }
        if (!isAmount(run.reservation) || run.reservation <= 0 || !isCount(now)) {
            throw new TypeError('coordinator state: invalid reservation');
        }
        const added = this.#db
            .query('INSERT INTO attempts (repo, pr, head, run, reservation, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .run(run.repo, run.pr, run.head, run.run, run.reservation, now);
        return Number(added.lastInsertRowid);
    }

    /** The run completed and logged a cost, which replaces its reservation. Once only. */
    logCost(attemptId: number, cost: number): void {
        if (!isAmount(cost)) throw new TypeError('coordinator state: invalid cost');
        const done = this.#db
            .query('UPDATE attempts SET logged_cost = ? WHERE id = ? AND logged_cost IS NULL')
            .run(cost, attemptId);
        if (done.changes !== 1) throw new Error(`coordinator state: attempt ${attemptId} is unknown or already logged`);
    }

    /** The attempt ledger of one PR, every head, as `decide` reads it. No row is left out. */
    attemptsFor(repo: string, pr: number): Attempt[] {
        return this.#db
            .query(
                'SELECT head AS headSha, reservation, logged_cost AS loggedCost FROM attempts ' +
                    'WHERE repo = ? AND pr = ? ORDER BY id',
            )
            .all(repo, pr) as Attempt[];
    }

    // ── Triage ─────────────────────────────────────────────────────────────

    /**
     * Keeps what `bin/triage` printed for one head, so a later pass does not pay
     * for it again (or get another pick, orphaning the reviews already run).
     * Raw stdout: `parseTriage` reads it every time. The first answer stands.
     */
    saveTriage(at: { repo: string; pr: number; head: string }, stdout: string, now: number): void {
        if (!isText(at.repo) || !isCount(at.pr) || at.pr < 1 || !isFullSha(at.head) || !isCount(now)) {
            throw new TypeError('coordinator state: invalid triage record');
        }
        if (typeof stdout !== 'string') throw new TypeError('coordinator state: invalid triage record');
        this.#db
            .query('INSERT INTO triage (repo, pr, head, stdout, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING')
            .run(at.repo, at.pr, at.head, stdout, now);
    }

    /** What triage printed for exactly this head; null when it has not run there. */
    triageFor(repo: string, pr: number, head: string): string | null {
        const row = this.#db
            .query('SELECT stdout FROM triage WHERE repo = ? AND pr = ? AND head = ?')
            .get(repo, pr, head);
        return isRecord(row) && typeof row.stdout === 'string' ? row.stdout : null;
    }

    /**
     * The latest blocking-findings note that has a receipt, with the time the
     * receipt was recorded. An intent without a receipt is not a delivered note.
     */
    blockingNoteFor(repo: string, pr: number): BlockingNote | null {
        const row = this.#db
            .query(
                'SELECT i.head AS headSha, r.at AS at FROM intents i JOIN receipts r ON r.intent_id = i.id ' +
                    'WHERE i.repo = ? AND i.pr = ? AND i.kind = ? AND i.reason = ? AND i.state = ? ' +
                    'ORDER BY r.at DESC, i.rowid DESC LIMIT 1',
            )
            .get(repo, pr, 'note', 'blocking-findings', 'done');
        if (!isRecord(row) || !isFullSha(row.headSha) || !isCount(row.at)) return null;
        return { headSha: row.headSha, at: row.at };
    }
}
