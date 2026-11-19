import { describe, expect, test } from 'bun:test';
import { Invoak, escalationId, invoakPrincipal } from './invoak';
import type { CommandResult } from './readers';

// Answer shapes are invoak's own (`show`, `comment`, `create` with --json, 2026-11-18).
const SELF = 'spidersan';
const SECRET = 'f'.repeat(64);
const OPTIONS = { self: SELF, project: 'sp', owner: 'treebird', secret: SECRET };
const ACTION = 'note:owner/name#7:' + 'a'.repeat(40) + ':1';
const BODY = `Two blocking findings.\n\naction-id: ${ACTION}`;
const TASK = 'sp-abcd';
const LEGACY = escalationId('sp', ACTION, SECRET);

const json = (value: unknown): string => JSON.stringify(value);
const ok = (value: unknown): CommandResult => ({ exitCode: 0, stdout: json(value) });
const failed = (code: string): CommandResult => ({
    exitCode: 1,
    stdout: json({ ok: false, error: { code, message: 'x' } }),
});
const comment = (over: Record<string, unknown> = {}) => ({
    id: 'c-1',
    author: SELF,
    taskId: TASK,
    body: BODY,
    ...over,
});
const shown = (comments: unknown[]) =>
    ok({ task: { id: TASK, legacyId: null }, comments, dependencies: [], labels: [] });

/** An adapter whose every command gets `answer`; `calls` records the argv. */
function scripted(answer: CommandResult | (() => CommandResult)) {
    const calls: string[][] = [];
    const invoak = new Invoak((command, argv) => {
        calls.push([command, ...argv]);
        return typeof answer === 'function' ? answer() : answer;
    }, OPTIONS);
    return { invoak, calls };
}

describe('escalationId', () => {
    test('the same action gives the same id, another action another', () => {
        expect(LEGACY).toMatch(/^sp-esc-[0-9a-f]{32}$/);
        expect(escalationId('sp', ACTION, SECRET)).toBe(LEGACY);
        expect(escalationId('sp', `${ACTION}x`, SECRET)).not.toBe(LEGACY);
    });

    test('without the secret the id cannot be worked out from the action', () => {
        expect(escalationId('sp', ACTION, 'e'.repeat(64))).not.toBe(LEGACY);
    });
});

describe('constructor', () => {
    test.each([
        ['self', { ...OPTIONS, self: '--json' }],
        ['owner', { ...OPTIONS, owner: '' }],
        ['a short secret', { ...OPTIONS, secret: 'abc' }],
        ['project', { ...OPTIONS, project: 'sp;rm' }],
    ])('refuses a malformed %s', (_name, options) => {
        expect(() => new Invoak(() => ok({}), options)).toThrow(TypeError);
    });
});

describe('findDelivery', () => {
    const query = { taskId: TASK, actionId: ACTION };

    test('found: this coordinator’s comment carrying the action id', async () => {
        const { invoak, calls } = scripted(shown([comment({ id: 'c-0', body: 'unrelated' }), comment()]));
        expect(await invoak.findDelivery(query)).toEqual({ kind: 'found', receipt: 'c-1' });
        expect(calls).toEqual([['invoak', 'show', '--json', TASK]]);
    });

    test('absent: the task read whole and no such comment', async () => {
        expect(await scripted(shown([])).invoak.findDelivery(query)).toEqual({ kind: 'absent' });
        expect(await scripted(shown([comment({ body: 'other' })])).invoak.findDelivery(query)).toEqual({
            kind: 'absent',
        });
    });

    test('someone else quoting the action id is not a delivery', async () => {
        expect(await scripted(shown([comment({ author: 'mycsan' })])).invoak.findDelivery(query)).toEqual({
            kind: 'absent',
        });
    });

    test('a longer action id that starts the same is not this one', async () => {
        const longer = comment({ body: `x\n\naction-id: ${ACTION}0` });
        expect(await scripted(shown([longer])).invoak.findDelivery(query)).toEqual({ kind: 'absent' });
    });

    test('the action id line may be followed by more text, or by a carriage return', async () => {
        const padded = comment({ body: `x\n\naction-id: ${ACTION}\r\n\nmore` });
        expect(await scripted(shown([padded])).invoak.findDelivery(query)).toEqual({ kind: 'found', receipt: 'c-1' });
    });

    test.each([
        ['the task does not exist', failed('NOT_FOUND')],
        ['invoak refused', failed('FORBIDDEN_TIER')],
        ['exit 0 with no task', ok({ comments: [] })],
        ['no comments list', ok({ task: { id: TASK } })],
        ['a comment with no body', shown([{ id: 'c-1', author: SELF }])],
        ['a matching comment with no id', shown([comment({ id: '' })])],
        ['output that is not JSON', { exitCode: 0, stdout: 'Too many requests' }],
        ['no exit', { exitCode: null, stdout: '' }],
    ])('%s: unknown', async (_name, answer) => {
        expect(await scripted(answer).invoak.findDelivery(query)).toEqual({ kind: 'unknown' });
    });

    test.each([
        ['a task id that is a flag', { taskId: '--help', actionId: ACTION }],
        ['a task id with a space', { taskId: 'sp-ab cd', actionId: ACTION }],
        ['an empty action id', { taskId: TASK, actionId: '' }],
    ])('%s: nothing is run', async (_name, bad) => {
        const { invoak, calls } = scripted(shown([]));
        expect(await invoak.findDelivery(bad)).toEqual({ kind: 'unknown' });
        expect(calls).toEqual([]);
    });

    test('a runner that throws: unknown', async () => {
        const invoak = new Invoak(() => {
            throw new Error('spawn failed');
        }, OPTIONS);
        expect(await invoak.findDelivery(query)).toEqual({ kind: 'unknown' });
        expect(await invoak.findEscalation({ actionId: ACTION })).toEqual({ kind: 'unknown' });
        expect(await invoak.deliverNote({ actionId: ACTION, taskId: TASK, body: BODY })).toEqual({ kind: 'unknown' });
    });
});

describe('deliverNote', () => {
    const request = { actionId: ACTION, taskId: TASK, body: BODY };

    test('sent: the body is one argv element and the receipt is the comment id', async () => {
        const { invoak, calls } = scripted(ok({ comment: comment() }));
        expect(await invoak.deliverNote(request)).toEqual({ kind: 'sent', receipt: 'c-1' });
        // The body is the last token: `comment` posts everything after the task id, flags included.
        expect(calls).toEqual([['invoak', 'comment', '--json', TASK, BODY]]);
    });

    test.each([
        ['invoak refused', failed('RATE_LIMITED')],
        ['exit 1 that printed a comment', { exitCode: 1, stdout: json({ comment: comment() }) }],
        ['no comment id', ok({ comment: {} })],
        ['not JSON', { exitCode: 0, stdout: '' }],
    ])('%s: unknown', async (_name, answer) => {
        expect(await scripted(answer).invoak.deliverNote(request)).toEqual({ kind: 'unknown' });
    });

    test.each([
        ['a body the CLI would read as a flag', { ...request, body: `--json\n\naction-id: ${ACTION}` }],
        ['a body without its action id', { ...request, body: 'Two blocking findings.' }],
        ['a body with a NUL', { ...request, body: `a\0b\n\naction-id: ${ACTION}` }],
        ['a bad task id', { ...request, taskId: '../x' }],
    ])('%s: nothing is run', async (_name, bad) => {
        const { invoak, calls } = scripted(ok({ comment: comment() }));
        expect(await invoak.deliverNote(bad)).toEqual({ kind: 'unknown' });
        expect(calls).toEqual([]);
    });
});

describe('findEscalation', () => {
    test('found: the task with this action’s legacy id', async () => {
        const { invoak, calls } = scripted(ok({ task: { id: 'sp-wxyz', legacyId: LEGACY }, comments: [] }));
        expect(await invoak.findEscalation({ actionId: ACTION })).toEqual({ kind: 'found', receipt: 'sp-wxyz' });
        expect(calls).toEqual([['invoak', 'show', '--json', LEGACY]]);
    });

    test('absent only on invoak’s NOT_FOUND', async () => {
        expect(await scripted(failed('NOT_FOUND')).invoak.findEscalation({ actionId: ACTION })).toEqual({
            kind: 'absent',
        });
    });

    test.each([
        ['another error', failed('FORBIDDEN_TIER')],
        ['a task with another legacy id', ok({ task: { id: 'sp-wxyz', legacyId: 'sp-esc-other' } })],
        ['a task with no id', ok({ task: { legacyId: LEGACY } })],
        ['not JSON', { exitCode: 1, stdout: 'NOT_FOUND' }],
    ])('%s: unknown', async (_name, answer) => {
        expect(await scripted(answer).invoak.findEscalation({ actionId: ACTION })).toEqual({ kind: 'unknown' });
    });
});

describe('createEscalation', () => {
    const request = {
        actionId: ACTION,
        repo: 'owner/name',
        pr: 7,
        head: 'a'.repeat(40),
        reason: 'fork',
        to: 'treebird',
        body: BODY,
    };
    const created = ok({ task: { id: 'sp-wxyz', legacyId: LEGACY }, dispatchDecision: null });

    test('to the owner: waits for human dispatch, addressed to nobody', async () => {
        const { invoak, calls } = scripted(created);
        expect(await invoak.createEscalation(request)).toEqual({ kind: 'sent', receipt: 'sp-wxyz' });
        expect(calls).toEqual([
            [
                'invoak',
                'create',
                '--json',
                '--project',
                'sp',
                '--summary',
                'Coordinator escalation: owner/name#7 fork',
                '--description',
                BODY,
                '--legacy-id',
                LEGACY,
                '--needs-approval',
            ],
        ]);
    });

    test('to a claimant: addressed to that agent', async () => {
        const { invoak, calls } = scripted(created);
        await invoak.createEscalation({ ...request, to: 'mycsan' });
        expect(calls[0]?.slice(-2)).toEqual(['--for', '@mycsan']);
    });

    test.each([
        ['the legacy id is taken (a second create for the same action)', failed('LEGACY_ID_TAKEN')],
        ['a task with another legacy id came back', ok({ task: { id: 'sp-wxyz', legacyId: null } })],
        ['no task id', ok({ task: { legacyId: LEGACY } })],
        ['not JSON', { exitCode: 0, stdout: 'created' }],
    ])('%s: unknown, for reconcile to look up', async (_name, answer) => {
        expect(await scripted(answer).invoak.createEscalation(request)).toEqual({ kind: 'unknown' });
    });

    test.each([
        ['an addressee that is a flag', { ...request, to: '--needs-approval' }],
        ['an addressee with an @', { ...request, to: '@mycsan' }],
        ['a body without its action id', { ...request, body: 'x' }],
        ['a reason that is a flag', { ...request, reason: '-x' }],
        ['a fractional PR', { ...request, pr: 1.5 }],
    ])('%s: nothing is run', async (_name, bad) => {
        const { invoak, calls } = scripted(created);
        expect(await invoak.createEscalation(bad)).toEqual({ kind: 'unknown' });
        expect(calls).toEqual([]);
    });
});

describe('task', () => {
    const task = (over: Record<string, unknown> = {}) =>
        ok({ task: { id: TASK, legacyId: null, status: 'in_progress', claimedBy: 'mycsan', ...over }, comments: [] });

    test('a task imported under a legacy id is that task too', async () => {
        expect(await scripted(task({ id: 'u-1', legacyId: TASK })).invoak.task(TASK)).not.toBeNull();
    });

    test('status and claimant of the task shown under that id (shape of a real `show`, 2026-11-19)', async () => {
        const { invoak, calls } = scripted(task());
        expect(await invoak.task(TASK)).toEqual({ status: 'in_progress', claimedBy: 'mycsan' });
        expect(calls).toEqual([['invoak', 'show', '--json', TASK]]);
    });

    test('an unclaimed task has no claimant', async () => {
        expect(await scripted(task({ claimedBy: null })).invoak.task(TASK)).toEqual({
            status: 'in_progress',
            claimedBy: null,
        });
    });

    test.each([
        ['another task answers', task({ id: 'sp-other' })],
        ['no status', task({ status: undefined })],
        ['NOT_FOUND', failed('NOT_FOUND')],
        ['any other failure', failed('NO_CREDENTIAL')],
    ])('null when %s', async (_name, answer) => {
        expect(await scripted(answer).invoak.task(TASK)).toBeNull();
    });

    test('an id that is not a task id is never asked about', async () => {
        const { invoak, calls } = scripted(task());
        expect(await invoak.task('--help')).toBeNull();
        expect(calls).toEqual([]);
    });
});

describe('invoakPrincipal', () => {
    const who = (stdout: string, exitCode = 0) => invoakPrincipal(() => ({ exitCode, stdout }));

    test('the principal invoak says it is (shape of a real `whoami`, 2026-11-19)', async () => {
        const calls: string[][] = [];
        const principal = await invoakPrincipal((command, argv) => {
            calls.push([command, ...argv]);
            return {
                exitCode: 0,
                stdout: json({ whoami: { tier: 'agent', principal: 'spidersan', via: 'agent-session' } }),
            };
        });
        expect(principal).toBe('spidersan');
        expect(calls).toEqual([['invoak', 'whoami', '--json']]);
    });

    test.each([
        ['a failed command', json({ whoami: { principal: 'spidersan' } }), 1],
        ['no principal', json({ whoami: {} }), 0],
        ['a principal that is not one', json({ whoami: { principal: '--for' } }), 0],
        ['not JSON', 'spidersan', 0],
    ])('null on %s', async (_name, stdout, exit) => {
        expect(await who(stdout, exit)).toBeNull();
    });

    test('null when the runner throws', async () => {
        expect(
            await invoakPrincipal(() => {
                throw new Error('no invoak');
            }),
        ).toBeNull();
    });
});
