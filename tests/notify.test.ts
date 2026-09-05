import { describe, it, expect } from 'vitest';
import {
    deliver,
    nullNotifier,
    toakRoomNotifier,
    type NotifyEvent,
    type Notifier,
} from '../src/lib/notify.js';

const event: NotifyEvent = {
    repo: 'treebird7/spidersan-oss',
    branch: 'sherlock/x',
    tier: 3,
    message: 'CLAUDE.md contested by two branches',
    dedupe: 'push:abc1234',
    agent: 'sherlock',
    files: ['CLAUDE.md'],
};

function capture() {
    const lines: string[] = [];
    return { lines, log: (m: string) => lines.push(m) };
}

describe('deliver', () => {
    // THE regression test for sp-8iqm. The original bug was a daemon that
    // logged "hive signal emitted" for a command that no longer existed,
    // because the emit discarded its own callback result. A failed delivery
    // must be visible AND must not be reported as sent.
    it('logs the failure reason and never claims success when delivery fails', async () => {
        const dead: Notifier = async () => ({ ok: false, reason: 'ENOTFOUND toak.me' });
        const { lines, log } = capture();

        const result = await deliver(dead, event, log);

        expect(result).toEqual({ ok: false, reason: 'ENOTFOUND toak.me' });
        expect(lines.join('\n')).toContain('NOT NOTIFIED');
        expect(lines.join('\n')).toContain('ENOTFOUND toak.me');
        expect(lines.some((l) => l.startsWith('notified:'))).toBe(false);
    });

    it('claims success only when the adapter reports delivery', async () => {
        const live: Notifier = async () => ({ ok: true });
        const { lines, log } = capture();

        await deliver(live, event, log);

        expect(lines.some((l) => l.startsWith('notified:'))).toBe(true);
        expect(lines.join('\n')).not.toContain('NOT NOTIFIED');
    });
});

describe('nullNotifier', () => {
    it('reports undelivered rather than pretending', async () => {
        expect(await nullNotifier(event)).toEqual({
            ok: false,
            reason: 'no transport configured (set TOAK_ROOM_TOKEN)',
        });
    });
});

describe('toakRoomNotifier', () => {
    it('treats a non-2xx as undelivered — the failure hub.postToChat swallowed', async () => {
        const fetchImpl = (async () =>
            new Response('Application not found', { status: 404 })) as unknown as typeof fetch;

        const result = await toakRoomNotifier('tok', fetchImpl)(event);

        expect(result.ok).toBe(false);
        expect((result as { reason: string }).reason).toContain('404');
    });

    it('treats a thrown network error as undelivered, not as a crash', async () => {
        const fetchImpl = (async () => {
            throw new Error('connect ECONNREFUSED');
        }) as unknown as typeof fetch;

        const result = await toakRoomNotifier('tok', fetchImpl)(event);

        expect(result).toEqual({ ok: false, reason: 'connect ECONNREFUSED' });
    });

    it('keys off dedupe, not the LLM-written message, so a replay cannot double-post', async () => {
        const bodies: string[] = [];
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            bodies.push(String(init.body));
            return new Response('{}', { status: 200 });
        }) as unknown as typeof fetch;

        const notifier = toakRoomNotifier('tok', fetchImpl);
        await notifier(event);
        // Same push, re-delivered by the catch-up poll. advice.message is
        // LLM-generated for tier>=2, so the prose differs on replay — the key
        // must not move with it.
        await notifier({ ...event, message: 'Two branches both modify CLAUDE.md' });

        const [first, second] = bodies.map((b) => JSON.parse(b));
        expect(first.idempotency_key).toBe(second.idempotency_key);
        expect(first.token).toBe('tok');
        expect(first.sender).toMatch(/^agent:/);
        expect(first.metadata.tier).toBe(3);
    });

    it('gives a different key to a different event', async () => {
        const bodies: string[] = [];
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            bodies.push(String(init.body));
            return new Response('{}', { status: 200 });
        }) as unknown as typeof fetch;

        const notifier = toakRoomNotifier('tok', fetchImpl);
        await notifier(event);
        await notifier({ ...event, branch: 'sherlock/y', dedupe: 'push:def5678' });

        const [a, b] = bodies.map((x) => JSON.parse(x));
        expect(a.idempotency_key).not.toBe(b.idempotency_key);
    });

    it('bounds the request — an unanswered POST must not stall the event handler', async () => {
        let seen: RequestInit | undefined;
        const fetchImpl = (async (_url: string, init: RequestInit) => {
            seen = init;
            return new Response('{}', { status: 200 });
        }) as unknown as typeof fetch;

        await toakRoomNotifier('tok', fetchImpl)(event);

        expect(seen?.signal).toBeInstanceOf(AbortSignal);
    });
});
