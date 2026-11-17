import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetState } from './decide';
import { SCHEMA_VERSION, State } from './state';
import type { NewIntent } from './state';

const sha = (c: string): string => c.repeat(40);
const HEAD = sha('a');
const BASE = sha('b');
const OTHER = sha('c');
const REPO = 'owner/name';
const NOW = 1_800_000_000_000;

let dir: string;
let path: string;
let state: State;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coord-state-'));
    path = join(dir, 'state.db');
    state = new State(path);
});

afterEach(() => {
    state.close();
    rmSync(dir, { recursive: true, force: true });
});

const merge = (over: Partial<NewIntent> = {}): NewIntent => ({
    kind: 'merge',
    repo: REPO,
    pr: 42,
    head: HEAD,
    base: BASE,
    reason: '',
    taskId: 'mycs-abcd',
    addressee: null,
    body: null,
    ...over,
});

const note = (over: Partial<NewIntent> = {}): NewIntent => ({
    kind: 'note',
    repo: REPO,
    pr: 42,
    head: HEAD,
    base: null,
    reason: 'blocking-findings',
    taskId: 'mycs-abcd',
    addressee: null,
    body: 'two findings',
    ...over,
});

/** Runs one statement on a second connection to the same file. */
function raw(sql: string, ...params: (string | number | null)[]): void {
    const other = new Database(path);
    other.query(sql).run(...params);
    other.close();
}

describe('schema', () => {
    test('opening an existing file keeps its rows and its single version row', () => {
        state.queue(merge(), NOW);
        state.close();
        state = new State(path);
        state.close();
        state = new State(path);
        expect(state.openIntents().open.map((i) => i.id)).toEqual([`merge:${REPO}#42@${HEAD}:1`]);
        const other = new Database(path, { readonly: true });
        expect(other.query('SELECT key, value FROM meta').all()).toEqual([
            { key: 'schema_version', value: String(SCHEMA_VERSION) },
        ]);
        other.close();
    });

    test('a file with another schema version is refused', () => {
        state.close();
        raw('UPDATE meta SET value = ? WHERE key = ?', String(SCHEMA_VERSION - 1), 'schema_version');
        expect(() => new State(path)).toThrow('unsupported schema version');
        raw('UPDATE meta SET value = ? WHERE key = ?', String(SCHEMA_VERSION), 'schema_version');
        state = new State(path);
    });
});

describe('attempt ledger', () => {
    test('attemptsFor is the Attempt[] decide reads: reservation until a cost is logged, then the cost', () => {
        const first = state.reserve({ repo: REPO, pr: 42, head: HEAD, run: 'triage', reservation: 0.25 }, NOW);
        state.reserve({ repo: REPO, pr: 42, head: OTHER, run: 'plain', reservation: 1.5 }, NOW);
        state.reserve({ repo: REPO, pr: 7, head: HEAD, run: 'plain', reservation: 9 }, NOW);
        state.reserve({ repo: 'owner/other', pr: 42, head: HEAD, run: 'plain', reservation: 9 }, NOW);

        expect(state.attemptsFor(REPO, 42)).toEqual([
            { headSha: HEAD, reservation: 0.25, loggedCost: null },
            { headSha: OTHER, reservation: 1.5, loggedCost: null },
        ]);
        expect(budgetState(state.attemptsFor(REPO, 42), { ceiling: 5, maxHeads: 4 }, HEAD)).toMatchObject({
            valid: true,
            spent: 1.75,
            admittedHeads: [HEAD, OTHER],
        });

        state.logCost(first, 0.75);
        expect(state.attemptsFor(REPO, 42)[0]).toEqual({ headSha: HEAD, reservation: 0.25, loggedCost: 0.75 });
        expect(budgetState(state.attemptsFor(REPO, 42), { ceiling: 5, maxHeads: 4 }, HEAD).spent).toBe(2.25);
    });

    test('a logged cost of 0 replaces the reservation', () => {
        const id = state.reserve({ repo: REPO, pr: 42, head: HEAD, run: 'plain', reservation: 1 }, NOW);
        state.logCost(id, 0);
        expect(budgetState(state.attemptsFor(REPO, 42), { ceiling: 5, maxHeads: 4 }, HEAD).spent).toBe(0);
    });

    test.each([
        ['zero reservation', { reservation: 0 }],
        ['negative reservation', { reservation: -1 }],
        ['NaN reservation', { reservation: Number.NaN }],
        ['infinite reservation', { reservation: Number.POSITIVE_INFINITY }],
        ['short sha', { head: HEAD.slice(0, 7) }],
        ['uppercase sha', { head: HEAD.toUpperCase() }],
        ['pr 0', { pr: 0 }],
        ['empty repo', { repo: '' }],
        ['empty run', { run: '' }],
    ])('reserve refuses a %s and writes nothing', (_name, over) => {
        const bad = { repo: REPO, pr: 42, head: HEAD, run: 'plain', reservation: 1, ...over };
        expect(() => state.reserve(bad, NOW)).toThrow(TypeError);
        expect(state.attemptsFor(REPO, 42)).toEqual([]);
    });

    test('a cost is logged once, for a known attempt, and is a finite amount ≥ 0', () => {
        const id = state.reserve({ repo: REPO, pr: 42, head: HEAD, run: 'plain', reservation: 1 }, NOW);
        expect(() => state.logCost(id, -0.1)).toThrow(TypeError);
        expect(() => state.logCost(id, Number.NaN)).toThrow(TypeError);
        expect(() => state.logCost(id + 1, 0.5)).toThrow('unknown or already logged');
        state.logCost(id, 0.5);
        expect(() => state.logCost(id, 0.6)).toThrow('unknown or already logged');
        expect(state.attemptsFor(REPO, 42)).toEqual([{ headSha: HEAD, reservation: 1, loggedCost: 0.5 }]);
    });
});

describe('intents', () => {
    test('queue returns the standing row instead of writing a second one', () => {
        const first = state.queue(note(), NOW);
        const again = state.queue(note({ body: 'different text' }), NOW + 1);
        expect(first.created).toBe(true);
        expect(again.created).toBe(false);
        expect(again.intent).toEqual(first.intent);
        expect(state.openIntents().open).toHaveLength(1);
    });

    test('a different head, PR, repo or reason is a different intent', () => {
        state.queue(note(), NOW);
        for (const over of [{ head: OTHER }, { pr: 43 }, { repo: 'owner/other' }, { reason: 'ci-red' }]) {
            expect(state.queue(note(over), NOW).created).toBe(true);
        }
        expect(state.openIntents().open).toHaveLength(5);
    });

    const rowCount = (): number => {
        const other = new Database(path, { readonly: true });
        const rows = other.query('SELECT id FROM intents').all();
        other.close();
        return rows.length;
    };

    test('an unsent or rolled-back intent may be tried again, under a new id', () => {
        const first = state.queue(merge(), NOW).intent;
        state.drop(first.id, 'unsent', NOW);
        const second = state.queue(merge(), NOW);
        expect(second.created).toBe(true);
        expect(second.intent.id).toBe(`merge:${REPO}#42@${HEAD}:2`);
        state.begin(second.intent.id, NOW);
        state.rollBackMerge(second.intent.id, NOW);
        expect(state.queue(merge(), NOW).intent.id).toBe(`merge:${REPO}#42@${HEAD}:3`);
        expect(rowCount()).toBe(4); // three merges and the gate reset the rollback queued
    });

    test('a merge some read has seen merged cannot be rolled back; the row and its hold stay', () => {
        const id = state.queue(merge(), NOW).intent.id;
        state.begin(id, NOW);
        state.markMergedSeen(id);
        expect(() => state.rollBackMerge(id, NOW + 1)).toThrow('seen merged');
        expect(state.intent(id)).toMatchObject({ state: 'pending', seenMerged: true, updatedAt: NOW });
        expect(rowCount()).toBe(1); // no gate reset was queued either
        expect(state.isHeld(REPO)).toBe(true);
    });

    test('merged-elsewhere keeps the observed head and commit and queues a gate reset for the intent head', () => {
        const id = state.queue(merge(), NOW).intent.id;
        state.begin(id, NOW);
        state.markMergedSeen(id);
        for (const bad of [
            { mergedHead: HEAD, mergeCommit: BASE }, // the intent's own head is a normal merge
            { mergedHead: OTHER.slice(0, 7), mergeCommit: BASE },
            { mergedHead: OTHER, mergeCommit: 'abc1234' },
        ]) {
            expect(() => state.settleMergedElsewhere(id, bad, NOW)).toThrow('merged elsewhere');
        }
        expect(state.intent(id)?.state).toBe('pending');

        state.settleMergedElsewhere(id, { mergedHead: OTHER, mergeCommit: BASE }, NOW + 1);
        expect(state.intent(id)).toMatchObject({
            state: 'merged-elsewhere',
            head: HEAD,
            mergedHead: OTHER,
            mergeCommit: BASE,
            seenMerged: true,
        });
        expect(state.openIntents().open.map((i) => [i.kind, i.head])).toEqual([['gate-reset', HEAD]]);
        // The PR is merged: no new merge intent at this head.
        expect(state.queue(merge(), NOW + 2)).toMatchObject({ created: false, intent: { state: 'merged-elsewhere' } });
    });

    test.each([['merge', merge()], ['note', note()]] as const)(
        'a dry-run %s asked for again reopens the same row instead of writing another',
        (_name, spec) => {
            const first = state.queue(spec, NOW).intent;
            for (let wake = 1; wake <= 3; wake++) {
                state.begin(first.id, NOW + wake);
                state.drop(first.id, 'dry-run', NOW + wake);
                const again = state.queue(spec, NOW + wake + 1);
                expect(again).toEqual({
                    created: true,
                    intent: { ...first, state: 'queued', updatedAt: NOW + wake + 1 },
                });
                expect(state.intent(first.id)?.state).toBe('queued');
            }
            expect(rowCount()).toBe(1);
        },
    );

    test('a done merge or note is never queued again; a done gate reset can be', () => {
        const m = state.queue(merge(), NOW).intent;
        state.begin(m.id, NOW);
        state.finishMerge(m.id, { mergeCommit: OTHER, gateReset: true, landedBody: 'landed' }, NOW);
        expect(state.queue(merge(), NOW)).toMatchObject({ created: false, intent: { state: 'done', mergeCommit: OTHER } });

        const n = state.queue(note(), NOW).intent;
        state.recordReceipt(n.id, 'comment-1', NOW);
        expect(state.queue(note(), NOW)).toMatchObject({ created: false, intent: { state: 'done' } });

        const gate = merge({ kind: 'gate-reset', base: null, taskId: null });
        const g = state.queue(gate, NOW);
        expect(g.created).toBe(false); // the one finishMerge queued
        state.finish(g.intent.id, NOW);
        expect(state.queue(gate, NOW).created).toBe(true);
    });

    test.each([
        ['short head', merge({ head: HEAD.slice(0, 7) })],
        ['uppercase head', merge({ head: HEAD.toUpperCase() })],
        ['merge without a base', merge({ base: null })],
        ['merge with a short base', merge({ base: BASE.slice(0, 7) })],
        ['merge without a task', merge({ taskId: null })],
        ['note without a task', note({ taskId: null })],
        ['note without a body', note({ body: null })],
        ['note without a reason', note({ reason: '' })],
        ['pr 0', note({ pr: 0 })],
        ['unknown kind', note({ kind: 'release' as never })],
    ])('queue refuses a %s and writes nothing', (_name, spec) => {
        expect(() => state.queue(spec, NOW)).toThrow(TypeError);
        expect(state.openIntents()).toEqual({ open: [], unrecognised: [] });
    });

    test('a settled intent cannot be begun, finished or dropped again', () => {
        const id = state.queue(note(), NOW).intent.id;
        state.recordReceipt(id, 'comment-1', NOW);
        expect(() => state.begin(id, NOW)).toThrow('not open');
        expect(() => state.drop(id, 'unsent', NOW)).toThrow('not open');
        expect(() => state.recordReceipt(id, 'comment-2', NOW)).toThrow('not open');
        expect(state.receipt(id)).toBe('comment-1');
    });

    test('finishMerge writes the commit, the landed note and the gate reset together or not at all', () => {
        const id = state.queue(merge(), NOW).intent.id;
        state.begin(id, NOW);
        // An empty landed body makes the second insert fail: the first must not stick.
        expect(() => state.finishMerge(id, { mergeCommit: OTHER, gateReset: true, landedBody: '' }, NOW)).toThrow();
        expect(state.intent(id)).toMatchObject({ state: 'pending', mergeCommit: null });
        expect(() => state.finishMerge(id, { mergeCommit: 'abc1234', gateReset: true, landedBody: 'x' }, NOW)).toThrow();
        expect(state.openIntents().open.map((i) => i.kind)).toEqual(['merge']);

        state.finishMerge(id, { mergeCommit: OTHER, gateReset: true, landedBody: 'landed' }, NOW);
        expect(state.intent(id)).toMatchObject({ state: 'done', mergeCommit: OTHER });
        expect(state.openIntents().open.map((i) => [i.kind, i.state, i.taskId])).toEqual([
            ['landed-note', 'queued', 'mycs-abcd'],
            ['gate-reset', 'queued', null],
        ]);
    });
});

describe('escalations', () => {
    const spec = { repo: REPO, pr: 42, head: HEAD, reason: 'fork', to: 'owner', body: 'a fork PR' };
    const count = (): number => {
        const other = new Database(path, { readonly: true });
        const rows = other.query('SELECT repo FROM escalations').all();
        other.close();
        return rows.length;
    };

    test('one escalation per (repo, pr, head, reason)', () => {
        const first = state.escalation(spec, NOW);
        const again = state.escalation({ ...spec, body: 'said again' }, NOW + 1);
        expect(first.created).toBe(true);
        expect(again.created).toBe(false);
        expect(again.intent.id).toBe(first.intent.id);
        expect(count()).toBe(1);

        state.recordReceipt(first.intent.id, 'sp-1', NOW);
        expect(state.escalation(spec, NOW + 2).created).toBe(false);
        expect(count()).toBe(1);
    });

    test('another head, reason, PR or repo is another escalation', () => {
        state.escalation(spec, NOW);
        for (const over of [{ head: OTHER }, { reason: 'stalled-owner' }, { pr: 43 }, { repo: 'owner/other' }]) {
            expect(state.escalation({ ...spec, ...over }, NOW).created).toBe(true);
        }
        expect(count()).toBe(5);
    });

    test('an escalation with no addressee, body or reason is refused and leaves no row', () => {
        for (const over of [{ to: '' }, { body: '' }, { reason: '' }]) {
            expect(() => state.escalation({ ...spec, ...over }, NOW)).toThrow(TypeError);
        }
        expect(count()).toBe(0);
        expect(state.openIntents().open).toEqual([]);
    });
});

describe('blockingNoteFor', () => {
    test('null until the blocking-findings note has a receipt; then its head and receipt time', () => {
        expect(state.blockingNoteFor(REPO, 42)).toBeNull();
        const id = state.queue(note(), NOW).intent.id;
        expect(state.blockingNoteFor(REPO, 42)).toBeNull();
        state.begin(id, NOW);
        expect(state.blockingNoteFor(REPO, 42)).toBeNull();
        state.recordReceipt(id, 'comment-1', NOW + 5);
        expect(state.blockingNoteFor(REPO, 42)).toEqual({ headSha: HEAD, at: NOW + 5 });
        expect(state.blockingNoteFor(REPO, 43)).toBeNull();
        expect(state.blockingNoteFor('owner/other', 42)).toBeNull();
    });

    test('a dry-run record, another reason and a landed note are not a blocking note', () => {
        state.drop(state.queue(note(), NOW).intent.id, 'dry-run', NOW);
        state.recordReceipt(state.queue(note({ reason: 'ci-red' }), NOW).intent.id, 'comment-1', NOW);
        state.recordReceipt(state.queue(note({ kind: 'landed-note', reason: '' }), NOW).intent.id, 'comment-2', NOW);
        expect(state.blockingNoteFor(REPO, 42)).toBeNull();
    });

    test('the latest delivered note wins', () => {
        state.recordReceipt(state.queue(note(), NOW).intent.id, 'comment-1', NOW);
        state.recordReceipt(state.queue(note({ head: OTHER }), NOW).intent.id, 'comment-2', NOW + 9);
        expect(state.blockingNoteFor(REPO, 42)).toEqual({ headSha: OTHER, at: NOW + 9 });
    });
});

describe('held repos', () => {
    test('an open merge or gate reset holds its repo; an open note does not', () => {
        state.queue(note(), NOW);
        expect(state.heldRepos()).toEqual([]);
        const id = state.queue(merge(), NOW).intent.id;
        expect(state.isHeld(REPO)).toBe(true);
        expect(state.isHeld('owner/other')).toBe(false);
        state.begin(id, NOW);
        expect(state.isHeld(REPO)).toBe(true);
        state.rollBackMerge(id, NOW);
        expect(state.openIntents().open.map((i) => i.kind)).toEqual(['note', 'gate-reset']);
        expect(state.isHeld(REPO)).toBe(true);
        state.finish(`gate-reset:${REPO}#42@${HEAD}:1`, NOW);
        expect(state.heldRepos()).toEqual([]);
    });

    test.each([
        ['an unknown state', 'UPDATE intents SET state = ?', 'merging'],
        ['an unknown kind', 'UPDATE intents SET kind = ?', 'release'],
        ['a missing task', 'UPDATE intents SET task_id = ?', null],
        ['a non-hex head', 'UPDATE intents SET head = ?', 'z'.repeat(40)],
    ])('an open row with %s is unrecognised and holds its repo, whatever its kind', (_name, sql, value) => {
        const id = state.queue(note(), NOW).intent.id;
        raw(sql, value);
        const head = sql.includes('head') ? value : HEAD;
        expect(state.openIntents()).toEqual({ open: [], unrecognised: [{ id, repo: REPO, pr: 42, head }] });
        expect(state.heldRepos()).toEqual([REPO]);
        expect(state.intent(id)).toBeNull();
        expect(() => state.queue(note(), NOW)).toThrow();
    });
});
