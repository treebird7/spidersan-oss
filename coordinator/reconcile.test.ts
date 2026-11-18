import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DryRunEffects, READ_EFFECTS, WRITE_EFFECTS } from './effects';
import type { RegistryRead } from './effects';
import { EFFECT_NAMES, FakeEffects } from './fake-effects';
import type { Fault } from './fake-effects';
import { Actions, MERGE_GRACE_MS } from './reconcile';
import type { EscalationSpec, NoteSpec } from './reconcile';
import { State } from './state';
import type { MergeTarget } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────

const sha = (c: string): string => c.repeat(40);
const HEAD = sha('a');
const BASE = sha('b');
const OTHER = sha('c');
const REPO = 'owner/name';
const PR = 42;
const TASK = 'mycs-abcd';
const NOW = 1_800_000_000_000;
/** The first moment at which a merge call made at NOW is past its grace period. */
const LATER = NOW + MERGE_GRACE_MS;

const TARGET: MergeTarget = { repo: REPO, pr: PR, head: HEAD, base: BASE };
const MERGE_ID = `merge:${REPO}#${PR}@${HEAD}:1`;
const GATE_ID = `gate-reset:${REPO}#${PR}@${HEAD}:1`;
const LANDED_ID = `landed-note:${REPO}#${PR}@${HEAD}:1`;
const NOTE: NoteSpec = { repo: REPO, pr: PR, head: HEAD, reason: 'blocking-findings', taskId: TASK, body: 'two findings' };
const NOTE_ID = `note:${REPO}#${PR}@${HEAD}:blocking-findings:1`;
const ESCALATION: EscalationSpec = { repo: REPO, pr: PR, head: HEAD, reason: 'fork', to: 'owner', body: 'a fork PR' };
const ESCALATION_ID = `escalation:${REPO}#${PR}@${HEAD}:fork:1`;

const GATE = `${REPO}@${HEAD}`;
const PR_KEY = `${REPO}#${PR}`;

let dir: string;
let path: string;
let state: State;
let fx: FakeEffects;
let actions: Actions;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'coord-reconcile-'));
    path = join(dir, 'state.db');
    state = new State(path);
    fx = new FakeEffects();
    actions = new Actions(state, fx);
    // PR 42 is open at HEAD on BASE, with no gate status on HEAD.
    fx.prs.set(PR_KEY, { kind: 'open', head: HEAD, base: BASE });
    fx.gates.set(GATE, 'clear');
});

afterEach(() => {
    state.close();
    rmSync(dir, { recursive: true, force: true });
});

/** A new wake: the old process is gone. Only the file and the outside world remain. */
function wake(): void {
    state.close();
    state = new State(path);
    actions = new Actions(state, fx);
}

/** Runs one statement on a second connection to the same file. */
function raw(sql: string, ...params: (string | number | null)[]): void {
    const other = new Database(path);
    other.query(sql).run(...params);
    other.close();
}

const stateOf = (id: string): string | undefined => state.intent(id)?.state;

/** Every state any row in the file is in, read on a second connection. */
function statesInFile(): unknown[] {
    const other = new Database(path, { readonly: true });
    const rows = other.query('SELECT DISTINCT state FROM intents').all() as { state: unknown }[];
    other.close();
    return rows.map((row) => row.state);
}
const writeNames = (): string[] => fx.writes().map((call) => call.effect);

/** Leaves a merge intent `pending` with the PR in fact merged: a crash right after the merge call. */
async function crashAfterMerge(): Promise<void> {
    fx.failNext('merge', 'lost-response');
    expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'held' });
    expect(fx.prs.get(PR_KEY)).toEqual({ kind: 'merged', head: HEAD, mergeCommit: fx.mergeCommit });
    expect(stateOf(MERGE_ID)).toBe('pending');
    wake();
}

/** Leaves a merge intent `pending` with the PR still open: the call never landed. */
async function mergeNeverLanded(): Promise<void> {
    fx.failNext('merge', 'lost-request');
    expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'held' });
    expect(stateOf(MERGE_ID)).toBe('pending');
    wake();
}

/** Answers that say nothing: a caller must conclude nothing from any of them. */
const SAYS_NOTHING: [string, Fault][] = [
    ['unknown', { answer: { kind: 'unknown' } }],
    ['a kind outside the set', { answer: { kind: 'probably-fine' } }],
    ['null', { answer: null }],
    ['a bare string', { answer: 'merged' }],
    ['a thrown error', 'lost-request'],
];

// ── Write-ahead ────────────────────────────────────────────────────────────

describe('write-ahead', () => {
    test('every write effect finds its row already committed as pending when it is called', async () => {
        const seen: [string, unknown][] = [];
        fx.onCall = (effect, request) => {
            if (!(effect in WRITE_EFFECTS)) return;
            // A second connection sees only what is committed.
            const other = new Database(path, { readonly: true });
            const row = other.query('SELECT state FROM intents WHERE id = ?').get((request as { actionId: string }).actionId);
            other.close();
            seen.push([effect, (row as { state?: unknown } | null)?.state]);
        };

        fx.gateResetFails = true;
        await actions.merge(TARGET, TASK, NOW); // merge
        await actions.note(NOTE, NOW); // deliverNote
        await actions.escalate(ESCALATION, NOW); // createEscalation
        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
        await actions.reconcile(NOW); // resetGate, deliverNote (landed)

        expect(seen).toEqual([
            ['merge', 'pending'],
            ['deliverNote', 'pending'],
            ['createEscalation', 'pending'],
            ['resetGate', 'pending'],
            ['deliverNote', 'pending'],
        ]);
        expect(new Set(seen.map(([effect]) => effect))).toEqual(new Set(Object.keys(WRITE_EFFECTS)));
    });

    test('reconcile.ts reaches the write half of the adapter in the constructor and in #perform only', () => {
        const source = readFileSync(join(import.meta.dir, 'reconcile.ts'), 'utf8');
        expect(source.match(/this\.#writes\b.*/g)).toEqual(['this.#writes = effects;', 'this.#writes));']);
        // Every other mention of a write method is inside a callback handed to #perform.
        const calls = source.match(/\b\w+\.(merge|resetGate|deliverNote|createEscalation)\(/g) ?? [];
        expect(calls.length).toBe(4);
        expect(calls.every((call) => call.startsWith('writes.'))).toBe(true);
        expect(source.match(/\(writes\) =>/g)).toHaveLength(4);
        expect(source).not.toContain('this.#reads as');
    });

    test('when the row cannot be written, the call is not made', async () => {
        await expect(actions.note({ ...NOTE, head: HEAD.slice(0, 7) }, NOW)).rejects.toThrow(TypeError);
        await expect(actions.escalate({ ...ESCALATION, to: '' }, NOW)).rejects.toThrow(TypeError);
        await expect(actions.merge({ ...TARGET, base: 'main' }, TASK, NOW)).rejects.toThrow(TypeError);
        await expect(actions.merge(TARGET, '', NOW)).rejects.toThrow(TypeError);
        expect(fx.calls).toEqual([]);
    });

    test('the action id is in the body the adapter is given', async () => {
        await actions.note(NOTE, NOW);
        await actions.escalate(ESCALATION, NOW);
        expect(fx.posted).toEqual([`two findings\n\naction-id: ${NOTE_ID}`, `a fork PR\n\naction-id: ${ESCALATION_ID}`]);
    });
});

// ── Merge ──────────────────────────────────────────────────────────────────

describe('merge', () => {
    test('a clean merge records the squash commit and queues the landed note', async () => {
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'merged', mergeCommit: fx.mergeCommit });
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'done', mergeCommit: fx.mergeCommit });
        expect(state.intent(LANDED_ID)).toMatchObject({ state: 'queued', taskId: TASK });
        expect(state.heldRepos()).toEqual([]);
        expect(fx.writes()).toEqual([
            { effect: 'merge', request: { actionId: MERGE_ID, repo: REPO, pr: PR, head: HEAD } },
        ]);
    });

    test.each([
        ['the base moved', { kind: 'open', head: HEAD, base: OTHER }],
        ['the head moved', { kind: 'open', head: OTHER, base: BASE }],
        ['the PR is closed', { kind: 'closed' }],
        ['the PR is already merged', { kind: 'merged', head: HEAD, mergeCommit: sha('e') }],
        ['the PR cannot be read', { kind: 'unknown' }],
    ] as const)('when %s after the intent is written, the intent is dropped unsent and no merge is sent', async (_name, pr) => {
        fx.prs.set(PR_KEY, pr);
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'dropped' });
        expect(stateOf(MERGE_ID)).toBe('unsent');
        expect(fx.writes()).toEqual([]);
        expect(state.heldRepos()).toEqual([]);
    });

    test('a dropped merge can be tried again once the PR reads as expected', async () => {
        fx.prs.set(PR_KEY, { kind: 'open', head: HEAD, base: OTHER });
        await actions.merge(TARGET, TASK, NOW);
        fx.prs.set(PR_KEY, { kind: 'open', head: HEAD, base: BASE });
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'merged', mergeCommit: fx.mergeCommit });
        expect(stateOf(`merge:${REPO}#${PR}@${HEAD}:2`)).toBe('done');
    });

    test('a refused merge is rolled back and its head queued for a gate check', async () => {
        fx.failNext('merge', { answer: { kind: 'refused' } });
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'refused' });
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
        expect(stateOf(GATE_ID)).toBe('queued');
        expect(state.intent(LANDED_ID)).toBeNull();
    });

    test.each([
        ...SAYS_NOTHING,
        ['merged with a short commit sha', { answer: { kind: 'merged', mergeCommit: 'abc1234' } }],
        ['merged with no commit sha', { answer: { kind: 'merged' } }],
        ['a lost response', 'lost-response'],
    ] as [string, Fault][])('a merge answered with %s holds the repo and records no result', async (_name, fault) => {
        fx.failNext('merge', fault);
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'held' });
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'pending', mergeCommit: null });
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(state.heldRepos()).toEqual([REPO]);
    });

    test('a merge that is already done answers from the record, without a call', async () => {
        await actions.merge(TARGET, TASK, NOW);
        const before = fx.calls.length;
        expect(await actions.merge(TARGET, TASK, NOW + 1)).toEqual({ kind: 'merged', mergeCommit: fx.mergeCommit });
        expect(fx.calls.length).toBe(before);
    });
});

// ── Reconcile: merges ──────────────────────────────────────────────────────

describe('reconcile: crash after the merge call', () => {
    test('finds the PR merged, records the squash commit, queues the landed note, and does not merge again', async () => {
        await crashAfterMerge();

        const report = await actions.reconcile(NOW + 1);

        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'done', mergeCommit: fx.mergeCommit });
        expect(state.intent(LANDED_ID)).toMatchObject({ state: 'queued', taskId: TASK });
        expect(fx.count('merge')).toBe(1);
        expect(writeNames()).toEqual(['merge']);
        expect(report).toEqual({ pending: [LANDED_ID], unrecognised: [], held: [] });
    });

    test('then finishes the landed note once the registry row reads merged', async () => {
        await crashAfterMerge();
        await actions.reconcile(NOW + 1);
        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });

        const report = await actions.reconcile(NOW + 2);

        expect(fx.posted).toEqual([
            `${REPO}#${PR} landed as ${fx.mergeCommit} (head ${HEAD}).\n\naction-id: ${LANDED_ID}`,
        ]);
        expect(state.receipt(LANDED_ID)).toBe('comment-1');
        expect(fx.count('merge')).toBe(1);
        expect(report).toEqual({ pending: [], unrecognised: [], held: [] });
    });

    test('a merge intent that was written but never sent is closed unsent without asking or merging', async () => {
        state.queue(
            { kind: 'merge', ...TARGET, reason: '', taskId: TASK, addressee: null, body: null },
            NOW,
        );
        wake();
        const report = await actions.reconcile(NOW + 1);
        expect(stateOf(MERGE_ID)).toBe('unsent');
        expect(fx.calls).toEqual([]);
        expect(report).toEqual({ pending: [], unrecognised: [], held: [] });
    });
});

describe('reconcile: ambiguous merge result', () => {
    test('the repo is held and nothing is retried until reconcile can tell', async () => {
        fx.prs.set('owner/name#43', { kind: 'open', head: OTHER, base: BASE });
        fx.prs.set('owner/other#1', { kind: 'open', head: OTHER, base: BASE });
        fx.failNext('merge', { answer: { kind: 'unknown' } });
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'held' });
        wake();

        // Reconcile cannot tell yet: the PR read says nothing, twice.
        fx.failNext('readPr', { answer: { kind: 'unknown' } });
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        fx.failNext('readPr', 'lost-request');
        expect(await actions.reconcile(NOW + 2)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(stateOf(MERGE_ID)).toBe('pending');

        // Nothing else merges in the held repo: not this PR, not another one. No call is made for either.
        const before = fx.calls.length;
        expect(await actions.merge(TARGET, TASK, NOW + 3)).toEqual({ kind: 'held' });
        expect(await actions.merge({ ...TARGET, pr: 43, head: OTHER }, 'mycs-efgh', NOW + 3)).toEqual({ kind: 'held' });
        expect(fx.calls.length).toBe(before);
        expect(writeNames()).toEqual(['merge']);

        // Another repo is not held.
        expect(await actions.merge({ repo: 'owner/other', pr: 1, head: OTHER, base: BASE }, 'tb-abcd', NOW + 3)).toEqual({
            kind: 'merged',
            mergeCommit: fx.mergeCommit,
        });

        // The PR reads open, but inside the grace period that proves nothing.
        expect(await actions.reconcile(NOW + 4)).toMatchObject({ held: [REPO] });
        expect(stateOf(MERGE_ID)).toBe('pending');

        // Still open after the grace period: the merge did not happen. Rolled back, the gate checked, the hold lifted.
        expect(await actions.reconcile(LATER)).toEqual({
            pending: [`landed-note:owner/other#1@${OTHER}:1`], // the other repo's merge, waiting on its registry row
            unrecognised: [],
            held: [],
        });
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
        expect(fx.count('merge')).toBe(2); // the first attempt and owner/other; no retry
    });

    test.each([
        ...SAYS_NOTHING,
        ['merged with a short commit sha', { answer: { kind: 'merged', head: HEAD, mergeCommit: 'abc1234' } }],
        ['merged with no commit sha', { answer: { kind: 'merged', head: HEAD } }],
        ['merged with a short head', { answer: { kind: 'merged', head: HEAD.slice(0, 7), mergeCommit: sha('e') } }],
    ] as [string, Fault][])('a PR read answered with %s leaves the merge pending and the repo held', async (_name, fault) => {
        await crashAfterMerge();
        fx.failNext('readPr', fault);
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'pending', mergeCommit: null });
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(writeNames()).toEqual(['merge']);
    });

    test('a PR merged at another head stays held and escalates to the owner, once', async () => {
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'merged', head: OTHER, mergeCommit: sha('e') });

        const report = await actions.reconcile(NOW + 1);
        await actions.reconcile(NOW + 2);

        const escalationId = `escalation:${REPO}#${PR}@${HEAD}:merged-at-unexpected-head:1`;
        expect(report).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(state.intent(escalationId)).toMatchObject({ state: 'done', addressee: 'owner' });
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(writeNames()).toEqual(['merge', 'createEscalation']);
    });

    test.each([
        ['unverified', { answer: { kind: 'unverified' } }],
        ['pending', { answer: { kind: 'pending' } }],
        ['denied', { answer: { kind: 'denied' } }],
        ...SAYS_NOTHING,
    ] as [string, Fault][])('… and stays held while the owner approval reads %s', async (_name, fault) => {
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'merged', head: OTHER, mergeCommit: sha('e') });
        fx.failNext('readApproval', fault);
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(fx.calls.at(-1)).toEqual({ effect: 'readApproval', request: { escalation: 'task-1' } });
    });

    test('… and once the owner approves, the observed head and commit are kept; it is never recorded as rolled back', async () => {
        fx.gates.set(GATE, 'success');
        fx.gates.set(`${REPO}@${OTHER}`, 'success');
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'merged', head: OTHER, mergeCommit: sha('e') });
        expect((await actions.reconcile(NOW + 1)).held).toEqual([REPO]); // nobody answered: unverified

        fx.approvals.set('task-1', 'approved');
        expect(await actions.reconcile(LATER + 2)).toEqual({ pending: [], unrecognised: [], held: [] });
        await actions.reconcile(LATER + 3);

        expect(state.intent(MERGE_ID)).toMatchObject({
            state: 'merged-elsewhere',
            head: HEAD,
            mergedHead: OTHER,
            mergeCommit: sha('e'),
        });
        expect(statesInFile()).not.toContain('rolled-back');
        // No landed note: the coordinator's merge is not what landed.
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(fx.posted).toHaveLength(1); // the escalation
        // The gate is reset on the intent's head only.
        expect(fx.writes().at(-1)).toEqual({ effect: 'resetGate', request: { actionId: GATE_ID, repo: REPO, head: HEAD } });
        expect(fx.gates.get(GATE)).toBe('clear');
        expect(fx.gates.get(`${REPO}@${OTHER}`)).toBe('success');
        expect(writeNames()).toEqual(['merge', 'createEscalation', 'resetGate']);
        // Asking to merge that head again makes no call.
        const before = fx.calls.length;
        expect(await actions.merge(TARGET, TASK, LATER + 4)).toEqual({ kind: 'dropped' });
        expect(fx.calls.length).toBe(before);
    });

    test('an approval is not read for an escalation that has no receipt', async () => {
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'merged', head: OTHER, mergeCommit: sha('e') });
        fx.failNext('createEscalation', 'lost-request');
        fx.approvals.set('task-1', 'approved');
        expect((await actions.reconcile(NOW + 1)).held).toEqual([REPO]);
        expect(fx.count('readApproval')).toBe(0);
    });
});

describe('reconcile: a PR that does not read as merged after a merge call', () => {
    test('open at the intent head inside the grace period: held, nothing rolled back, nothing retried', async () => {
        await mergeNeverLanded();
        for (const now of [NOW + 1, LATER - 1]) {
            expect(await actions.reconcile(now)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        }
        expect(stateOf(MERGE_ID)).toBe('pending');
        expect(state.intent(GATE_ID)).toBeNull();
        expect(await actions.merge(TARGET, TASK, LATER - 1)).toEqual({ kind: 'held' });
        expect(writeNames()).toEqual(['merge']);
    });

    test('open at the intent head once the grace period has passed: rolled back', async () => {
        await mergeNeverLanded();
        await actions.reconcile(LATER - 1);
        expect(stateOf(MERGE_ID)).toBe('pending');
        expect(await actions.reconcile(LATER)).toEqual({ pending: [], unrecognised: [], held: [] });
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(fx.count('merge')).toBe(1);
    });

    test('read as open first, merged later: finishes, and the landed note is queued and sent exactly once', async () => {
        await crashAfterMerge(); // the merge landed
        const lagging = { answer: { kind: 'open', head: HEAD, base: BASE } };
        fx.failNext('readPr', lagging);
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        fx.failNext('readPr', lagging);
        expect(await actions.reconcile(LATER - 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(state.intent(LANDED_ID)).toBeNull();

        // GitHub catches up.
        expect(await actions.reconcile(LATER - 1)).toEqual({ pending: [LANDED_ID], unrecognised: [], held: [] });
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'done', mergeCommit: fx.mergeCommit });

        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
        await actions.reconcile(LATER);
        await actions.reconcile(LATER + 1);
        expect(fx.posted).toEqual([
            `${REPO}#${PR} landed as ${fx.mergeCommit} (head ${HEAD}).\n\naction-id: ${LANDED_ID}`,
        ]);
        expect(fx.count('merge')).toBe(1);
        const other = new Database(path, { readonly: true });
        expect(other.query('SELECT id FROM intents WHERE kind = ?').all('landed-note')).toEqual([{ id: LANDED_ID }]);
        other.close();
    });

    test('closed without merging gets the same grace period', async () => {
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'closed' });
        expect(await actions.reconcile(LATER - 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(await actions.reconcile(LATER)).toEqual({ pending: [], unrecognised: [], held: [] });
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
    });

    test('open at another head is rolled back at once: the pinned merge cannot have landed', async () => {
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'open', head: OTHER, base: BASE });
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [], unrecognised: [], held: [] });
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
    });

    test.each([
        ['a short head', HEAD.slice(0, 7)],
        ['no head', undefined],
    ])('open with %s says nothing, even after the grace period', async (_name, head) => {
        await mergeNeverLanded();
        fx.failNext('readPr', { answer: { kind: 'open', head, base: BASE } });
        expect(await actions.reconcile(LATER + 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
    });

    test('a clock that reads earlier than the merge call never ends the grace period', async () => {
        await mergeNeverLanded();
        expect(await actions.reconcile(NOW - 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
    });

    test('the grace period can be passed in; a value that is not a finite amount ≥ 0 is refused', async () => {
        await mergeNeverLanded();
        actions = new Actions(state, fx, 5);
        expect((await actions.reconcile(NOW + 4)).held).toEqual([REPO]);
        expect((await actions.reconcile(NOW + 5)).held).toEqual([]);
        for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(() => new Actions(state, fx, bad)).toThrow(TypeError);
        }
    });
});

describe('a merge that any read has said is merged is never rolled back', () => {
    const MERGED_READS: [string, Fault][] = [
        ['merged at another head', { answer: { kind: 'merged', head: OTHER, mergeCommit: sha('e') } }],
        ['merged with a short commit sha', { answer: { kind: 'merged', head: HEAD, mergeCommit: 'abc1234' } }],
        ['merged with nothing else', { answer: { kind: 'merged' } }],
    ];
    const NOT_MERGED: [string, Fault][] = [
        ['open at the intent head', { answer: { kind: 'open', head: HEAD, base: BASE } }],
        ['open at another head', { answer: { kind: 'open', head: OTHER, base: BASE } }],
        ['closed', { answer: { kind: 'closed' } }],
    ];

    describe.each(MERGED_READS)('after a read that said %s', (_name, merged) => {
        test.each(NOT_MERGED)('reconcile: a later read of %s, past the grace period, does not roll it back', async (_n, later) => {
            await mergeNeverLanded();
            fx.failNext('readPr', merged);
            await actions.reconcile(NOW + 1);
            expect(state.intent(MERGE_ID)).toMatchObject({ state: 'pending', seenMerged: true });
            wake();

            fx.failNext('readPr', later);
            const report = await actions.reconcile(LATER + 1);

            expect(report.pending).toContain(MERGE_ID);
            expect(report.held).toEqual([REPO]);
            expect(statesInFile()).not.toContain('rolled-back');
            expect(state.intent(GATE_ID)).toBeNull();
        });

        test('merge(): the refused path cannot be reached; the repo is held and no call is made', async () => {
            await mergeNeverLanded();
            fx.failNext('readPr', merged);
            await actions.reconcile(NOW + 1);
            fx.failNext('merge', { answer: { kind: 'refused' } });
            const before = fx.calls.length;

            expect(await actions.merge(TARGET, TASK, LATER + 1)).toEqual({ kind: 'held' });

            expect(fx.calls.length).toBe(before);
            expect(statesInFile()).not.toContain('rolled-back');
        });
    });

    test.each([
        ['open at the intent head', { kind: 'open', head: HEAD, base: BASE }, `open at head ${HEAD}`],
        ['closed', { kind: 'closed' }, 'closed without merging'],
    ] as const)(
        'merged, then %s past the grace period: escalated to the owner once across three reconciles, still held, never rolled back',
        async (_name, later, wording) => {
            await mergeNeverLanded();
            fx.failNext('readPr', { answer: { kind: 'merged', head: HEAD, mergeCommit: 'abc1234' } });
            await actions.reconcile(NOW + 1);
            fx.prs.set(PR_KEY, later);

            // Inside the grace period the contradiction is not reported yet.
            await actions.reconcile(LATER - 1);
            expect(fx.count('createEscalation')).toBe(0);

            const escalationId = `escalation:${REPO}#${PR}@${HEAD}:merge-state-contradictory:1`;
            for (const now of [LATER, LATER + 1, LATER + 2]) {
                wake();
                expect(await actions.reconcile(now)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
            }
            expect(fx.writes().slice(1)).toEqual([
                {
                    effect: 'createEscalation',
                    request: {
                        actionId: escalationId,
                        repo: REPO,
                        pr: PR,
                        head: HEAD,
                        reason: 'merge-state-contradictory',
                        to: 'owner',
                        body: expect.stringMatching(
                            new RegExp(`^Merge intent ${MERGE_ID.replace(/[#@]/g, '.')}, pinned to head ${HEAD}: an earlier read said .* was merged; it now reads ${wording}\\.`),
                        ),
                    },
                },
            ]);
            expect(statesInFile()).not.toContain('rolled-back');

            // An owner approval of that escalation is not read and releases nothing.
            fx.approvals.set(state.receipt(escalationId) ?? '', 'approved');
            expect(await actions.reconcile(LATER + 3)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
            expect(fx.count('readApproval')).toBe(0);
            expect(stateOf(MERGE_ID)).toBe('pending');
        },
    );

    test('merge(): a PR that reads merged before the call closes the intent unsent, not rolled back', async () => {
        fx.prs.set(PR_KEY, { kind: 'merged', head: HEAD, mergeCommit: sha('e') });
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'dropped' });
        expect(statesInFile()).toEqual(['unsent']);
    });

    test('merge(): refused straight after a read of open at the intent head is the one rollback merge() makes', async () => {
        fx.failNext('merge', { answer: { kind: 'refused' } });
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'refused' });
        expect(fx.calls.map((call) => call.effect)).toEqual(['readPr', 'merge']);
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'rolled-back', seenMerged: false });
    });
});

// ── Reconcile: the merge gate ──────────────────────────────────────────────

describe('reconcile: pr-status.sh exit 3 (merged, gate reset failed)', () => {
    test('resets the gate status on the merged head and does not retry the merge', async () => {
        fx.gateResetFails = true;
        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'merged', mergeCommit: fx.mergeCommit });
        expect(fx.gates.get(GATE)).toBe('success');
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'done', mergeCommit: fx.mergeCommit });
        expect(stateOf(GATE_ID)).toBe('queued');
        expect(state.heldRepos()).toEqual([REPO]);
        wake();

        const report = await actions.reconcile(NOW + 1);

        expect(fx.gates.get(GATE)).toBe('clear');
        expect(fx.writes()).toEqual([
            { effect: 'merge', request: { actionId: MERGE_ID, repo: REPO, pr: PR, head: HEAD } },
            { effect: 'resetGate', request: { actionId: GATE_ID, repo: REPO, head: HEAD } },
        ]);
        expect(stateOf(GATE_ID)).toBe('done');
        expect(report).toEqual({ pending: [LANDED_ID], unrecognised: [], held: [] });
    });

    test('the same when the process died before exit 3 was recorded', async () => {
        fx.gateResetFails = true;
        await crashAfterMerge();
        expect(fx.gates.get(GATE)).toBe('success');

        await actions.reconcile(NOW + 1);

        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'done', mergeCommit: fx.mergeCommit });
        expect(fx.gates.get(GATE)).toBe('clear');
        expect(writeNames()).toEqual(['merge', 'resetGate']);
    });
});

describe('reconcile: stale merge-gate success on a head that was not merged', () => {
    test('rolls the merge back and resets the status on that head', async () => {
        fx.gates.set(GATE, 'success'); // posted before the merge call, which never landed
        await mergeNeverLanded();

        const report = await actions.reconcile(LATER + 1);

        expect(stateOf(MERGE_ID)).toBe('rolled-back');
        expect(fx.gates.get(GATE)).toBe('clear');
        expect(fx.prs.get(PR_KEY)).toEqual({ kind: 'open', head: HEAD, base: BASE });
        expect(writeNames()).toEqual(['merge', 'resetGate']);
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(report).toEqual({ pending: [], unrecognised: [], held: [] });
    });

    test('the status is read on the intent head, not the head the PR has now', async () => {
        fx.gates.set(GATE, 'success');
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'open', head: OTHER, base: BASE }); // the author pushed
        fx.gates.set(`${REPO}@${OTHER}`, 'success');

        await actions.reconcile(NOW + 1);

        expect(fx.calls.filter((call) => call.effect === 'readGate')).toEqual([
            { effect: 'readGate', request: { repo: REPO, head: HEAD } },
        ]);
        // Open at another head: rolled back at once, inside the grace period.
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
        expect(fx.gates.get(GATE)).toBe('clear');
        expect(fx.gates.get(`${REPO}@${OTHER}`)).toBe('success');
    });

    test('a PR closed without merging is handled the same way', async () => {
        fx.gates.set(GATE, 'success');
        await mergeNeverLanded();
        fx.prs.set(PR_KEY, { kind: 'closed' });
        await actions.reconcile(LATER + 1);
        expect(stateOf(MERGE_ID)).toBe('rolled-back');
        expect(fx.gates.get(GATE)).toBe('clear');
    });

    test('a status that is not success is left alone: no reset call', async () => {
        await mergeNeverLanded();
        const report = await actions.reconcile(LATER + 1);
        expect(stateOf(GATE_ID)).toBe('done');
        expect(writeNames()).toEqual(['merge']);
        expect(report.held).toEqual([]);
    });

    test.each(SAYS_NOTHING)('a gate read answered with %s resets nothing and keeps the repo held', async (_name, fault) => {
        fx.gates.set(GATE, 'success');
        await mergeNeverLanded();
        fx.failNext('readGate', fault);

        expect(await actions.reconcile(LATER + 1)).toEqual({ pending: [GATE_ID], unrecognised: [], held: [REPO] });
        expect(writeNames()).toEqual(['merge']);
        expect(await actions.merge(TARGET, TASK, LATER + 2)).toEqual({ kind: 'held' });

        // Once the gate can be read, it is reset and the hold lifts.
        expect(await actions.reconcile(LATER + 3)).toEqual({ pending: [], unrecognised: [], held: [] });
        expect(writeNames()).toEqual(['merge', 'resetGate']);
    });

    test.each([...SAYS_NOTHING, ['a lost response', 'lost-response']] as [string, Fault][])(
        'a reset answered with %s keeps the repo held until the status reads clear',
        async (_name, fault) => {
            fx.gates.set(GATE, 'success');
            await mergeNeverLanded();
            fx.failNext('resetGate', fault);

            expect(await actions.reconcile(LATER + 1)).toEqual({ pending: [GATE_ID], unrecognised: [], held: [REPO] });
            expect(stateOf(GATE_ID)).toBe('pending');

            expect(await actions.reconcile(LATER + 2)).toEqual({ pending: [], unrecognised: [], held: [] });
            expect(fx.gates.get(GATE)).toBe('clear');
            expect(fx.count('merge')).toBe(1);
        },
    );
});

// ── Reconcile: the landed note ─────────────────────────────────────────────

describe('reconcile: landed note', () => {
    const WAITING: [string, RegistryRead | Fault][] = [
        ['has no row for the PR', { kind: 'absent' }],
        ['cannot be read', { kind: 'unknown' }],
        ['reads active with no PR', { kind: 'row', status: 'active', prNumber: null }],
        ['reads active with the PR', { kind: 'row', status: 'active', prNumber: PR }],
        ['reads merged with no PR number', { kind: 'row', status: 'merged', prNumber: null }],
        ['reads merged for another PR', { kind: 'row', status: 'merged', prNumber: 43 }],
        ['reads abandoned with no PR', { kind: 'row', status: 'abandoned', prNumber: null }],
        ['reads a status outside the set', { answer: { kind: 'row', status: 'closed', prNumber: PR } }],
        ['answers merged without saying row', { answer: { status: 'merged', prNumber: PR } }],
        ['throws', 'lost-request'],
    ];

    test.each(WAITING)('stays queued and unsent while the registry %s', async (_name, registry) => {
        await actions.merge(TARGET, TASK, NOW);
        if (typeof registry === 'object' && 'kind' in registry) fx.registry.set(PR_KEY, registry);
        else fx.failNext('readRegistryRow', registry);

        const report = await actions.reconcile(NOW + 1);

        expect(report.pending).toEqual([LANDED_ID]);
        expect(stateOf(LANDED_ID)).toBe('queued');
        expect(fx.count('deliverNote')).toBe(0);
        expect(fx.count('findDelivery')).toBe(0);
        expect(fx.posted).toEqual([]);
    });

    test('is sent once the registry row reads merged for this PR, and only once', async () => {
        await actions.merge(TARGET, TASK, NOW);
        fx.registry.set(PR_KEY, { kind: 'absent' });
        await actions.reconcile(NOW + 1);
        expect(fx.posted).toEqual([]);

        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
        await actions.reconcile(NOW + 2);
        await actions.reconcile(NOW + 3);

        expect(fx.posted).toHaveLength(1);
        expect(fx.writes().at(-1)).toEqual({
            effect: 'deliverNote',
            request: {
                actionId: LANDED_ID,
                taskId: TASK,
                body: `${REPO}#${PR} landed as ${fx.mergeCommit} (head ${HEAD}).\n\naction-id: ${LANDED_ID}`,
            },
        });
        expect(state.intent(LANDED_ID)).toMatchObject({ state: 'done' });
        expect(state.receipt(LANDED_ID)).toBe('comment-1');
    });

    test('is not the blocking-findings note decide reads', async () => {
        await actions.merge(TARGET, TASK, NOW);
        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
        await actions.reconcile(NOW + 1);
        expect(state.blockingNoteFor(REPO, PR)).toBeNull();
    });
});

// ── Deliveries: never twice ────────────────────────────────────────────────

describe('a delivery whose response was lost is never delivered twice', () => {
    /** Each kind of delivery: how to start it with the given fault, and what it calls. */
    const KINDS = [
        {
            name: 'note',
            id: NOTE_ID,
            send: 'deliverNote',
            find: 'findDelivery',
            start: () => actions.note(NOTE, NOW),
        },
        {
            name: 'escalation',
            id: ESCALATION_ID,
            send: 'createEscalation',
            find: 'findEscalation',
            start: () => actions.escalate(ESCALATION, NOW),
        },
        {
            name: 'landed note',
            id: LANDED_ID,
            send: 'deliverNote',
            find: 'findDelivery',
            start: async () => {
                await actions.merge(TARGET, TASK, NOW);
                fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
                await actions.reconcile(NOW);
            },
        },
    ] as const;

    describe.each(KINDS)('$name', ({ id, send, find, start }) => {
        test('response lost: the next wake finds it by action id and keeps the receipt, without sending', async () => {
            fx.failNext(send, 'lost-response');
            await start();
            expect(stateOf(id)).toBe('pending');
            expect(state.receipt(id)).toBeNull();
            expect(fx.posted).toHaveLength(1);
            wake();

            await actions.reconcile(NOW + 1);
            await actions.reconcile(NOW + 2);

            expect(fx.count(send)).toBe(1);
            expect(fx.posted).toHaveLength(1);
            expect(stateOf(id)).toBe('done');
            expect(state.receipt(id)).toMatch(/^(comment|task)-1$/);
        });

        test('request lost: the next wake finds nothing and sends it, once', async () => {
            fx.failNext(send, 'lost-request');
            await start();
            expect(stateOf(id)).toBe('pending');
            expect(fx.posted).toEqual([]);
            wake();

            await actions.reconcile(NOW + 1);
            await actions.reconcile(NOW + 2);

            expect(fx.count(send)).toBe(2);
            expect(fx.posted).toHaveLength(1);
            expect(stateOf(id)).toBe('done');
        });

        test.each(SAYS_NOTHING)('lookup answered with %s: nothing is sent', async (_name, fault) => {
            fx.failNext(send, 'lost-response');
            await start();
            wake();
            fx.failNext(find, fault);

            const report = await actions.reconcile(NOW + 1);

            expect(report.pending).toEqual([id]);
            expect(fx.count(send)).toBe(1);
            expect(fx.posted).toHaveLength(1);
            expect(state.receipt(id)).toBeNull();
        });

        test.each([
            ...SAYS_NOTHING,
            ['sent with an empty receipt', { answer: { kind: 'sent', receipt: '' } }],
            ['sent with no receipt', { answer: { kind: 'sent' } }],
        ] as [string, Fault][])('send answered with %s: no receipt is recorded', async (_name, fault) => {
            fx.failNext(send, fault);
            await start();
            expect(stateOf(id)).toBe('pending');
            expect(state.receipt(id)).toBeNull();
        });

        test('found with an empty receipt is not a receipt', async () => {
            fx.failNext(send, 'lost-request');
            await start();
            fx.failNext(find, { answer: { kind: 'found', receipt: '' } });
            await actions.reconcile(NOW + 1);
            expect(stateOf(id)).toBe('pending');
            expect(fx.count(send)).toBe(1);
        });
    });

    test('asking again for a delivered note or escalation sends nothing and returns the receipt', async () => {
        expect(await actions.note(NOTE, NOW)).toEqual({ kind: 'delivered', receipt: 'comment-1' });
        expect(await actions.escalate(ESCALATION, NOW)).toEqual({ kind: 'delivered', receipt: 'task-2' });
        const before = fx.calls.length;
        expect(await actions.note({ ...NOTE, body: 'reworded' }, NOW + 1)).toEqual({ kind: 'delivered', receipt: 'comment-1' });
        expect(await actions.escalate({ ...ESCALATION, body: 'reworded' }, NOW + 1)).toEqual({
            kind: 'delivered',
            receipt: 'task-2',
        });
        expect(fx.calls.length).toBe(before);
    });

    test('asking again in the same wake, after a lost response, looks it up instead of re-sending', async () => {
        fx.failNext('deliverNote', 'lost-response');
        expect(await actions.note(NOTE, NOW)).toEqual({ kind: 'pending' });
        expect(await actions.note(NOTE, NOW + 1)).toEqual({ kind: 'delivered', receipt: 'comment-1' });
        expect(fx.count('deliverNote')).toBe(1);
    });

    test('a note already on the task under this action id is not sent, even with an empty database', async () => {
        fx.comments.set(`${TASK} ${NOTE_ID}`, 'comment-from-before');
        expect(await actions.note(NOTE, NOW)).toEqual({ kind: 'delivered', receipt: 'comment-from-before' });
        expect(fx.count('deliverNote')).toBe(0);
    });

    test('a delivered blocking-findings note becomes the BlockingNote decide reads; a pending one does not', async () => {
        fx.failNext('deliverNote', 'lost-response');
        await actions.note(NOTE, NOW);
        expect(state.blockingNoteFor(REPO, PR)).toBeNull();
        await actions.reconcile(NOW + 7);
        expect(state.blockingNoteFor(REPO, PR)).toEqual({ headSha: HEAD, at: NOW + 7 });
    });
});

// ── Registry rule ──────────────────────────────────────────────────────────

describe('registry rule (mycsan, invoak #188)', () => {
    test('the adapter has exactly four write effects and none of them touches the registry', () => {
        expect(Object.keys(WRITE_EFFECTS).sort()).toEqual(['createEscalation', 'deliverNote', 'merge', 'resetGate']);
        expect(Object.keys(READ_EFFECTS).sort()).toEqual([
            'findDelivery',
            'findEscalation',
            'readApproval',
            'readGate',
            'readPr',
            'readRegistryRow',
        ]);
        // Neither adapter in this slice carries an effect beyond those nine.
        const own = (proto: object): string[] =>
            Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');
        const fakeExtras = own(FakeEffects.prototype).filter(
            (name) => !EFFECT_NAMES.includes(name as never) && !['failNext', 'writes', 'count'].includes(name),
        );
        const dry = new DryRunEffects(fx);
        const dryNames = [...own(DryRunEffects.prototype), ...Object.keys(dry)].filter((name) => name !== 'recorded');
        expect(fakeExtras).toEqual([]);
        expect(dryNames.sort()).toEqual([...EFFECT_NAMES].sort());
    });

    test('an abandoned row carrying a prNumber is escalated to the owner, not repaired', async () => {
        await actions.merge(TARGET, TASK, NOW);
        fx.registry.set(PR_KEY, { kind: 'row', status: 'abandoned', prNumber: PR });
        const registryBefore = structuredClone([...fx.registry]);
        wake();

        const report = await actions.reconcile(NOW + 1);
        await actions.reconcile(NOW + 2);

        const escalationId = `escalation:${REPO}#${PR}@${HEAD}:registry-abandoned-with-pr:1`;
        // The only write after the merge is the escalation, raised once.
        expect(fx.writes().slice(1)).toEqual([
            {
                effect: 'createEscalation',
                request: {
                    actionId: escalationId,
                    repo: REPO,
                    pr: PR,
                    head: HEAD,
                    reason: 'registry-abandoned-with-pr',
                    to: 'owner',
                    body: expect.stringContaining('needs an owner repair'),
                },
            },
        ]);
        expect(state.intent(escalationId)).toMatchObject({ state: 'done', addressee: 'owner' });
        // The row is as it was, and the landed note still waits.
        expect([...fx.registry]).toEqual(registryBefore);
        expect(stateOf(LANDED_ID)).toBe('queued');
        expect(fx.posted).toHaveLength(1);
        expect(report.pending).toEqual([LANDED_ID]);
    });
});

// ── Dry run ────────────────────────────────────────────────────────────────

describe('dry-run adapter', () => {
    test('records every write, performs none, and nothing recorded counts as done or lifts a hold', async () => {
        const dry = new DryRunEffects(fx);
        actions = new Actions(state, dry);

        expect(await actions.merge(TARGET, TASK, NOW)).toEqual({ kind: 'dry-run' });
        expect(await actions.note(NOTE, NOW)).toEqual({ kind: 'dry-run' });
        expect(await actions.escalate(ESCALATION, NOW)).toEqual({ kind: 'dry-run' });
        // A gate reset left over from a live run.
        state.queue(
            { kind: 'gate-reset', repo: REPO, pr: PR, head: HEAD, base: null, reason: '', taskId: null, addressee: null, body: null },
            NOW,
        );
        fx.gates.set(GATE, 'success');
        const report = await actions.reconcile(NOW + 1);

        expect(dry.recorded.map((r) => r.effect)).toEqual(['merge', 'deliverNote', 'createEscalation', 'resetGate']);
        expect(fx.writes()).toEqual([]);
        expect(fx.prs.get(PR_KEY)).toEqual({ kind: 'open', head: HEAD, base: BASE });
        expect(fx.gates.get(GATE)).toBe('success');
        expect(fx.posted).toEqual([]);

        expect([MERGE_ID, NOTE_ID, ESCALATION_ID].map(stateOf)).toEqual(['dry-run', 'dry-run', 'dry-run']);
        expect(stateOf(GATE_ID)).toBe('pending'); // the status is still success
        expect(state.intent(MERGE_ID)?.mergeCommit).toBeNull();
        expect(state.intent(LANDED_ID)).toBeNull();
        expect(state.receipt(NOTE_ID)).toBeNull();
        expect(state.blockingNoteFor(REPO, PR)).toBeNull();
        expect(report).toEqual({ pending: [GATE_ID], unrecognised: [], held: [REPO] });
    });

    test.each([
        ['note', NOTE_ID, () => actions.note(NOTE, NOW)],
        ['escalation', ESCALATION_ID, () => actions.escalate(ESCALATION, NOW)],
    ] as const)('three dry-run wakes asking for the same %s leave one row; a live adapter then delivers it', async (_name, id, ask) => {
        const rows = (): unknown[] => {
            const other = new Database(path, { readonly: true });
            const found = other.query('SELECT id, state FROM intents').all();
            other.close();
            return found;
        };
        for (let n = 0; n < 3; n++) {
            wake();
            actions = new Actions(state, new DryRunEffects(fx));
            expect(await ask()).toEqual({ kind: 'dry-run' });
            expect(await actions.reconcile(NOW)).toEqual({ pending: [], unrecognised: [], held: [] });
            expect(rows()).toEqual([{ id, state: 'dry-run' }]);
        }
        expect(fx.writes()).toEqual([]);
        expect(state.receipt(id)).toBeNull();
        expect(state.blockingNoteFor(REPO, PR)).toBeNull();

        wake(); // live
        expect(await ask()).toMatchObject({ kind: 'delivered' });
        expect(rows()).toEqual([{ id, state: 'done' }]);
        expect(fx.posted).toHaveLength(1);
        expect(state.receipt(id)).not.toBeNull();
    });

    describe.each([
        ['note', NOTE_ID, 'deliverNote', () => actions.note(NOTE, NOW)],
        ['escalation', ESCALATION_ID, 'createEscalation', () => actions.escalate(ESCALATION, NOW)],
    ] as const)('a live %s whose request was lost', (_name, id, send, ask) => {
        test('is not closed by a dry-run wake; the next live reconcile sends it once, without being asked again', async () => {
            fx.failNext(send, 'lost-request');
            expect(await ask()).toEqual({ kind: 'pending' });
            wake();

            const dry = new DryRunEffects(fx);
            actions = new Actions(state, dry);
            expect((await actions.reconcile(NOW + 1)).pending).toEqual([id]);
            expect((await actions.reconcile(NOW + 2)).pending).toEqual([id]);
            expect(dry.recorded.map((r) => r.effect)).toEqual([send, send]);
            expect(stateOf(id)).toBe('pending');
            expect(fx.posted).toEqual([]);
            wake(); // live again; nobody asks for the note

            expect(await actions.reconcile(NOW + 3)).toEqual({ pending: [], unrecognised: [], held: [] });
            await actions.reconcile(NOW + 4);
            expect(fx.posted).toHaveLength(1);
            expect(fx.count(send)).toBe(2); // the lost request and this one
            expect(stateOf(id)).toBe('done');
            expect(state.receipt(id)).not.toBeNull();
        });

        test('is not closed when a dry-run wake asks for it again', async () => {
            fx.failNext(send, 'lost-request');
            await ask();
            actions = new Actions(state, new DryRunEffects(fx));
            expect(await ask()).toEqual({ kind: 'pending' });
            expect(stateOf(id)).toBe('pending');
        });
    });

    test('a live pending merge is not touched by a dry-run wake: no merge recorded, nothing closed', async () => {
        await crashAfterMerge();
        const dry = new DryRunEffects(fx);
        actions = new Actions(state, dry);
        fx.failNext('readPr', { answer: { kind: 'unknown' } });
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [MERGE_ID], unrecognised: [], held: [REPO] });
        expect(await actions.merge(TARGET, TASK, NOW + 1)).toEqual({ kind: 'held' });
        expect(dry.recorded).toEqual([]);
        expect(stateOf(MERGE_ID)).toBe('pending');
        wake();
        await actions.reconcile(NOW + 2);
        expect(state.intent(MERGE_ID)).toMatchObject({ state: 'done', mergeCommit: fx.mergeCommit });
        expect(fx.count('merge')).toBe(1);
    });

    test('a live pending gate reset is not closed by a dry-run wake; the next live reconcile resets it', async () => {
        fx.gateResetFails = true;
        await actions.merge(TARGET, TASK, NOW);
        fx.failNext('resetGate', 'lost-request');
        await actions.reconcile(NOW + 1);
        expect(stateOf(GATE_ID)).toBe('pending');
        wake();

        const dry = new DryRunEffects(fx);
        actions = new Actions(state, dry);
        expect(await actions.reconcile(NOW + 2)).toMatchObject({ held: [REPO] });
        expect(dry.recorded.map((r) => r.effect)).toEqual(['resetGate']);
        expect(stateOf(GATE_ID)).toBe('pending');
        expect(fx.gates.get(GATE)).toBe('success');
        wake();

        expect((await actions.reconcile(NOW + 3)).held).toEqual([]);
        expect(fx.gates.get(GATE)).toBe('clear');
    });

    test('a landed note owed for a real merge is not closed by a dry run; the next live wake sends it once', async () => {
        await actions.merge(TARGET, TASK, NOW); // live
        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
        const dry = new DryRunEffects(fx);
        actions = new Actions(state, dry);

        expect((await actions.reconcile(NOW + 1)).pending).toEqual([LANDED_ID]);
        expect((await actions.reconcile(NOW + 2)).pending).toEqual([LANDED_ID]);
        expect(dry.recorded.map((r) => r.effect)).toEqual(['deliverNote', 'deliverNote']);
        expect(fx.posted).toEqual([]);
        expect(state.receipt(LANDED_ID)).toBeNull();

        actions = new Actions(state, fx);
        await actions.reconcile(NOW + 3);
        await actions.reconcile(NOW + 4);
        expect(fx.posted).toHaveLength(1);
        expect(state.receipt(LANDED_ID)).toBe('comment-1');
    });
});

// ── Rows this code does not recognise ──────────────────────────────────────

describe('unrecognised rows', () => {
    test.each([
        ['a merge in an unknown state', MERGE_ID, 'UPDATE intents SET state = ? WHERE id = ?', 'merging'],
        ['a pending row of an unknown kind', MERGE_ID, 'UPDATE intents SET kind = ? WHERE id = ?', 'release'],
        ['a note in an unknown state', NOTE_ID, 'UPDATE intents SET state = ? WHERE id = ?', 'sending'],
        ['a note that lost its task', NOTE_ID, 'UPDATE intents SET task_id = ? WHERE id = ?', null],
    ])('%s is reported, holds its repo, and is not acted on', async (_name, id, sql, value) => {
        fx.failNext('merge', 'lost-request');
        await actions.merge(TARGET, TASK, NOW);
        fx.failNext('deliverNote', 'lost-request');
        await actions.note(NOTE, NOW);
        raw(sql, value, id);
        fx.prs.set(PR_KEY, { kind: 'unknown' }); // so the other row stays as it is
        fx.failNext('findDelivery', { answer: { kind: 'unknown' } });
        wake();
        const writesBefore = fx.writes().length;

        const report = await actions.reconcile(NOW + 1);
        fx.failNext('findDelivery', { answer: { kind: 'unknown' } });
        await actions.reconcile(NOW + 2);

        expect(report.unrecognised).toEqual([id]);
        expect(report.held).toEqual([REPO]);
        // The only write is one escalation to the owner that names the row.
        const escalationId = `escalation:${REPO}#${PR}@${HEAD}:unrecognised-intent-row:1`;
        expect(fx.writes().slice(writesBefore)).toEqual([
            {
                effect: 'createEscalation',
                request: {
                    actionId: escalationId,
                    repo: REPO,
                    pr: PR,
                    head: HEAD,
                    reason: 'unrecognised-intent-row',
                    to: 'owner',
                    body: expect.stringContaining(`cannot read: ${id}.`),
                },
            },
        ]);
        expect(state.intent(escalationId)).toMatchObject({ state: 'done', addressee: 'owner' });
        expect(await actions.merge({ ...TARGET, pr: 43, head: OTHER }, 'mycs-efgh', NOW + 3)).toEqual({ kind: 'held' });
    });

    test.each([
        ['head', 'UPDATE intents SET head = ? WHERE id = ?', 'z'.repeat(40)],
        ['PR number', 'UPDATE intents SET pr = ? WHERE id = ?', 0],
    ])('a row whose %s cannot be read either is reported and holds, without an escalation', async (_name, sql, value) => {
        fx.failNext('deliverNote', 'lost-request');
        await actions.note(NOTE, NOW);
        raw(sql, value, NOTE_ID);
        const report = await actions.reconcile(NOW + 1);
        expect(report).toEqual({ pending: [], unrecognised: [NOTE_ID], held: [REPO] });
        expect(fx.count('createEscalation')).toBe(0);
    });

    test('an unreadable escalation row does not stop the pass', async () => {
        fx.failNext('createEscalation', 'lost-request');
        await actions.escalate({ ...ESCALATION, reason: 'unrecognised-intent-row' }, NOW);
        const id = `escalation:${REPO}#${PR}@${HEAD}:unrecognised-intent-row:1`;
        raw('UPDATE intents SET state = ? WHERE id = ?', 'sending', id);
        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [], unrecognised: [id], held: [REPO] });
        expect(fx.count('createEscalation')).toBe(1);
    });
});

// ── A settled world stays settled ──────────────────────────────────────────

describe('reconcile is idempotent', () => {
    test('a second pass over a resolved state makes no write and changes nothing', async () => {
        fx.gateResetFails = true;
        await crashAfterMerge();
        fx.failNext('deliverNote', 'lost-response');
        await actions.note(NOTE, NOW);
        fx.failNext('createEscalation', 'lost-request');
        await actions.escalate(ESCALATION, NOW);
        fx.registry.set(PR_KEY, { kind: 'row', status: 'merged', prNumber: PR });
        wake();

        expect(await actions.reconcile(NOW + 1)).toEqual({ pending: [], unrecognised: [], held: [] });
        const writes = fx.writes().length;
        const calls = fx.calls.length;
        wake();

        expect(await actions.reconcile(NOW + 2)).toEqual({ pending: [], unrecognised: [], held: [] });
        expect(fx.writes().length).toBe(writes);
        expect(fx.calls.length).toBe(calls);
        expect(fx.count('merge')).toBe(1);
        expect(fx.posted).toHaveLength(3); // blocking note, escalation, landed note
    });
});
