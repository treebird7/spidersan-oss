/**
 * notify — the delivery seam for git-watch alerts.
 *
 * Every alert in git-events-subscriber.ts used to inline its own transport:
 * `execFile('envoak', ['hive','signal',...], cb)` with the callback discarding
 * the result. When `envoak hive signal` was removed (Envoak#148, ADR-0002) all
 * five sites died at once, and because no site inspected its own result the
 * daemon went on logging success for a month (sp-8iqm).
 *
 * So the transport lives behind one interface, and that interface returns a
 * RESULT rather than swallowing it. A caller cannot accidentally claim success:
 * there is a value it has to look at.
 *
 * Adapters are selected by env, so swapping transports is config, not code:
 *   TOAK_ROOM_TOKEN  — post to a toak.me room (POST /api/chat/send)
 *   unset            — nullNotifier: reports undelivered, never pretends
 */

import { createHash } from 'crypto';
import { hostname } from 'os';

export type Delivered = { ok: true } | { ok: false; reason: string };

export interface NotifyEvent {
    repo: string;
    branch: string;
    /** Conflict tier. Callers gate on this themselves — policy is not ours. */
    tier: number;
    /** Human-readable line. May be LLM-generated — never key off this. */
    message: string;
    /**
     * Stable identity of the underlying event, for deduplication. MUST be
     * built only from deterministic facts (repo, branch, sha, action) — the
     * tier>=2 path escalates to an LLM, so `message` differs between two
     * deliveries of the same event and cannot be used here.
     */
    dedupe: string;
    /** GitHub login or agent that triggered it, when known. */
    agent?: string;
    files?: string[];
    /** Extra fields passed through to the room as structured metadata. */
    details?: Record<string, unknown>;
}

/**
 * A transport. One function — nothing here needs a class.
 *
 * CONTRACT: a Notifier MUST NOT throw. It reports failure by returning
 * `{ok:false, reason}`. Call sites sit inside `catch` blocks that swallow
 * AI-layer errors, so a thrown transport error would be misread as an AI
 * failure and vanish — the same silence this module exists to remove.
 */
export type Notifier = (event: NotifyEvent) => Promise<Delivered>;

const TOAK_URL = process.env.TOAK_CHAT_URL || 'https://toak.me/api/chat/send';
// Bare name, no `agent:` prefix. Room allowlists match the sender string
// EXACTLY — the `agent:<id>` form in toak's send route governs verification
// upgrade, not allowlist matching, and conflating the two means an approved
// `spidersan` would not admit a sender of `agent:spidersan`. The machine goes
// in metadata instead, so one approval covers every host.
const SENDER = process.env.SPIDERSAN_AGENT || 'spidersan';
const MACHINE = process.env.TREEBIRD_MACHINE || hostname();

/**
 * Stable per event, so a catch-up poll that replays an event minutes later
 * does not post it twice. The server's own default is a ~5s time bucket, far
 * shorter than our reconnect window.
 */
function idempotencyKey(e: NotifyEvent): string {
    return createHash('sha256')
        .update([e.repo, e.branch, e.tier, e.dedupe].join(' '))
        .digest('hex');
}

/**
 * The original emits were fire-and-forget with `{ timeout: 10000 }`. These are
 * awaited inside the event handlers, so an unbounded fetch would stall the
 * handler and queue every event behind it. Same budget as before.
 */
const TIMEOUT_MS = 10_000;

function format(e: NotifyEvent): string {
    const who = e.agent ? ` by ${e.agent}` : '';
    const files = e.files?.length ? `\nfiles: ${e.files.slice(0, 10).join(', ')}` : '';
    return `TIER ${e.tier} conflict - ${e.repo}/${e.branch}${who}\n${e.message}${files}`;
}

/** Post to a toak.me room. The room join token is a read+write secret. */
export function toakRoomNotifier(token: string, fetchImpl: typeof fetch = fetch): Notifier {
    return async (event) => {
        try {
            const res = await fetchImpl(TOAK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(TIMEOUT_MS),
                body: JSON.stringify({
                    token,
                    sender: SENDER,
                    content: format(event),
                    idempotency_key: idempotencyKey(event),
                    metadata: {
                        machine: MACHINE,
                        repo: event.repo,
                        branch: event.branch,
                        tier: event.tier,
                        agent: event.agent,
                        files: event.files,
                        ...event.details,
                    },
                }),
            });
            // The POST response IS the call-time liveness check — no probe needed.
            if (!res.ok) {
                const body = await res.text().catch(() => '');
                return { ok: false, reason: `${res.status} ${body.slice(0, 120)}`.trim() };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: err instanceof Error ? err.message : String(err) };
        }
    };
}

/**
 * No transport configured. Reports undelivered rather than pretending — the
 * whole point of sp-8iqm is that a severed channel must be visible.
 */
export const nullNotifier: Notifier = async () => ({
    ok: false,
    reason: 'no transport configured (set TOAK_ROOM_TOKEN)',
});

export function createNotifier(): Notifier {
    const token = process.env.TOAK_ROOM_TOKEN;
    return token ? toakRoomNotifier(token) : nullNotifier;
}

/**
 * Deliver, then log the real outcome. This is the ONLY place allowed to say a
 * notification was sent, and it says so only after looking at the result.
 */
export async function deliver(
    notifier: Notifier,
    event: NotifyEvent,
    log: (m: string) => void,
): Promise<Delivered> {
    const result = await notifier(event);
    if (result.ok) log(`notified: TIER ${event.tier} ${event.repo}/${event.branch}`);
    else log(`NOT NOTIFIED (TIER ${event.tier} ${event.repo}/${event.branch}): ${result.reason}`);
    return result;
}
