/**
 * PR coordinator — acting on the outside world, and the reconcile pass
 * (slice 3 of 4).
 *
 * `Actions` is the only holder of the write half of the effects adapter. Every
 * write goes through `#perform`, which commits the intent row as `pending`
 * BEFORE it makes the call. A call that throws, answers `unknown`, or answers
 * something outside its closed set leaves the row `pending`: exactly what a
 * crash leaves. Only `reconcile` resolves a `pending` row, by asking the
 * adapter what happened.
 *
 * Fail closed: an unresolved merge or gate reset, or a row this code does not
 * recognise, holds its repo, and `merge` refuses in a held repo. Nothing here
 * writes to invoak's branch registry (the adapter has no method for it).
 */

import { isFullSha } from './decide';
import type { EffectReader, Effects, EffectWriter } from './effects';
import type { Intent, State } from './state';
import type { MergeTarget, ReasonOf } from './types';

/** Escalations the reconcile pass itself raises. Both go to the owner. */
export const RECONCILE_ESCALATIONS = ['merged-at-unexpected-head', 'registry-abandoned-with-pr'] as const;
export type ReconcileEscalation = (typeof RECONCILE_ESCALATIONS)[number];

export type MergeResult =
    | { kind: 'merged'; mergeCommit: string }
    /** Not attempted, or attempted with no known result. The repo is held. */
    | { kind: 'held' }
    /** Not attempted: the PR is no longer open at the intent's head and base. */
    | { kind: 'dropped' }
    /** Attempted and certainly not merged. */
    | { kind: 'refused' }
    | { kind: 'dry-run' };

export type DeliveryResult =
    | { kind: 'delivered'; receipt: string }
    /** No receipt yet; the next reconcile looks the action id up before any re-send. */
    | { kind: 'pending' }
    | { kind: 'dry-run' };

export interface ReconcileReport {
    /** Ids of intents still unresolved after the pass. */
    pending: string[];
    /** Ids of rows this code does not recognise. They hold their repo. */
    unrecognised: string[];
    /** Repos in which nothing may be merged. */
    held: string[];
}

export interface NoteSpec {
    repo: string;
    pr: number;
    head: string;
    reason: ReasonOf<'notify'>;
    taskId: string;
    body: string;
}

export interface EscalationSpec {
    repo: string;
    pr: number;
    head: string;
    reason: ReasonOf<'escalate'> | ReconcileEscalation;
    to: string;
    body: string;
}

const UNKNOWN = { kind: 'unknown' } as const;
const PENDING = { kind: 'pending' } as const;

/** An adapter answer with a string `kind`, else `unknown`. */
function answer<T extends { kind: string }>(value: T): T | typeof UNKNOWN {
    const raw: unknown = value;
    return typeof raw === 'object' && raw !== null && typeof (raw as { kind?: unknown }).kind === 'string'
        ? value
        : UNKNOWN;
}

export class Actions {
    readonly #state: State;
    readonly #reads: EffectReader;
    /** Used in `#perform` and nowhere else. */
    readonly #writes: EffectWriter;

    constructor(state: State, effects: Effects) {
        this.#state = state;
        this.#reads = effects;
        this.#writes = effects;
    }

    /** The one path to an external write: the row is committed as `pending`, then the call is made. */
    async #perform<T extends { kind: string }>(
        id: string,
        now: number,
        call: (writes: EffectWriter) => Promise<T>,
    ): Promise<T | typeof UNKNOWN> {
        this.#state.begin(id, now);
        try {
            return answer(await call(this.#writes));
        } catch {
            return UNKNOWN;
        }
    }

    async #read<T extends { kind: string }>(call: (reads: EffectReader) => Promise<T>): Promise<T | typeof UNKNOWN> {
        try {
            return answer(await call(this.#reads));
        } catch {
            return UNKNOWN;
        }
    }

    // ── What the loop calls ────────────────────────────────────────────────

    /**
     * Merges one PR pinned to `target.head`. Writes the intent, re-reads the PR
     * (it must still be open at this head and base), then merges.
     */
    async merge(target: MergeTarget, taskId: string, now: number): Promise<MergeResult> {
        if (this.#state.isHeld(target.repo)) return { kind: 'held' };
        const { intent, created } = this.#state.queue(
            {
                kind: 'merge',
                repo: target.repo,
                pr: target.pr,
                head: target.head,
                base: target.base,
                reason: '',
                taskId,
                addressee: null,
                body: null,
            },
            now,
        );
        if (!created) {
            return intent.mergeCommit !== null ? { kind: 'merged', mergeCommit: intent.mergeCommit } : { kind: 'held' };
        }
        const pr = await this.#read((reads) => reads.readPr({ repo: intent.repo, pr: intent.pr }));
        if (pr.kind !== 'open' || pr.head !== intent.head || pr.base !== intent.base) {
            // Still `queued`: no call was made, so there is nothing to reconcile.
            this.#state.drop(intent.id, 'rolled-back', now);
            return { kind: 'dropped' };
        }
        const outcome = await this.#perform(intent.id, now, (writes) =>
            writes.merge({ actionId: intent.id, repo: intent.repo, pr: intent.pr, head: intent.head }),
        );
        switch (outcome.kind) {
            case 'merged':
            case 'merged-gate-reset-failed':
                if (!isFullSha(outcome.mergeCommit)) return { kind: 'held' };
                this.#finishMerge(intent, outcome.mergeCommit, outcome.kind === 'merged-gate-reset-failed', now);
                return { kind: 'merged', mergeCommit: outcome.mergeCommit };
            case 'refused':
                this.#state.rollBackMerge(intent.id, now);
                return { kind: 'refused' };
            case 'dry-run':
                this.#state.drop(intent.id, 'dry-run', now);
                return { kind: 'dry-run' };
            default:
                return { kind: 'held' };
        }
    }

    /** Delivers one note per `(repo, pr, head, reason)` to the task. */
    async note(spec: NoteSpec, now: number): Promise<DeliveryResult> {
        const { intent } = this.#state.queue(
            {
                kind: 'note',
                repo: spec.repo,
                pr: spec.pr,
                head: spec.head,
                base: null,
                reason: spec.reason,
                taskId: spec.taskId,
                addressee: null,
                body: spec.body,
            },
            now,
        );
        return this.#deliver(intent, now);
    }

    /** Raises one escalation per `(repo, pr, head, reason)`. */
    async escalate(spec: EscalationSpec, now: number): Promise<DeliveryResult> {
        return this.#deliver(this.#state.escalation(spec, now).intent, now);
    }

    // ── Reconcile ──────────────────────────────────────────────────────────

    /**
     * Run at the start of a wake, before anything else: resolves every intent a
     * crash or a lost response left behind, by asking the adapter what happened.
     * Escalations left from earlier wakes go first, so one raised during this
     * pass is not attempted twice in it.
     */
    async reconcile(now: number): Promise<ReconcileReport> {
        for (const kind of ['escalation', 'merge', 'gate-reset', 'note', 'landed-note'] as const) {
            for (const intent of this.#state.openIntents().open) {
                if (intent.kind !== kind) continue;
                switch (intent.kind) {
                    case 'merge':
                        await this.#reconcileMerge(intent, now);
                        break;
                    case 'gate-reset':
                        await this.#reconcileGate(intent, now);
                        break;
                    case 'landed-note':
                        await this.#reconcileLanded(intent, now);
                        break;
                    case 'note':
                    case 'escalation':
                        await this.#deliver(intent, now);
                        break;
                    default:
                        intent.kind satisfies never;
                }
            }
        }
        const { open, unrecognised } = this.#state.openIntents();
        return {
            pending: open.map((intent) => intent.id),
            unrecognised: unrecognised.map((row) => row.id),
            held: this.#state.heldRepos(),
        };
    }

    async #reconcileMerge(intent: Intent, now: number): Promise<void> {
        if (intent.state === 'queued') {
            // The merge call is made only after `pending` is committed: it was never sent.
            this.#state.drop(intent.id, 'rolled-back', now);
            return;
        }
        const pr = await this.#read((reads) => reads.readPr({ repo: intent.repo, pr: intent.pr }));
        switch (pr.kind) {
            case 'merged':
                if (!isFullSha(pr.mergeCommit) || !isFullSha(pr.head)) return;
                if (pr.head !== intent.head) {
                    // Merged, but not the head this intent was pinned to. Held until the
                    // owner approves the escalation; any other answer keeps the hold.
                    const raised = await this.escalate(
                        {
                            repo: intent.repo,
                            pr: intent.pr,
                            head: intent.head,
                            reason: 'merged-at-unexpected-head',
                            to: 'owner',
                            body:
                                `${intent.repo}#${intent.pr} is merged at ${pr.head} as ${pr.mergeCommit}, but the ` +
                                `coordinator's merge was pinned to ${intent.head}. ${intent.repo} is held ` +
                                'until the owner approves this task.',
                        },
                        now,
                    );
                    if (raised.kind !== 'delivered') return;
                    const escalation = raised.receipt;
                    const approval = await this.#read((reads) => reads.readApproval({ escalation }));
                    if (approval.kind === 'approved') this.#state.rollBackMerge(intent.id, now);
                    return;
                }
                // Whether the gate status was reset is not known here: check it.
                this.#finishMerge(intent, pr.mergeCommit, true, now);
                return;
            case 'open':
            case 'closed':
                // Not merged, and not retried. A gate status may be left on the head.
                this.#state.rollBackMerge(intent.id, now);
                return;
            default:
                return;
        }
    }

    #finishMerge(intent: Intent, mergeCommit: string, gateReset: boolean, now: number): void {
        const landedBody = `${intent.repo}#${intent.pr} landed as ${mergeCommit} (head ${intent.head}).`;
        this.#state.finishMerge(intent.id, { mergeCommit, gateReset, landedBody }, now);
    }

    /** The gate status on the intent's own head: reset it if it reads `success`. */
    async #reconcileGate(intent: Intent, now: number): Promise<void> {
        const gate = await this.#read((reads) => reads.readGate({ repo: intent.repo, head: intent.head }));
        switch (gate.kind) {
            case 'clear':
                this.#state.finish(intent.id, now);
                return;
            case 'success': {
                const outcome = await this.#perform(intent.id, now, (writes) =>
                    writes.resetGate({ actionId: intent.id, repo: intent.repo, head: intent.head }),
                );
                // A `dry-run` answer reset nothing: the intent stays open and the repo held.
                if (outcome.kind === 'reset') this.#state.finish(intent.id, now);
                return;
            }
            default:
                return;
        }
    }

    /** The landed note goes out only once the registry row for this PR reads `merged`. */
    async #reconcileLanded(intent: Intent, now: number): Promise<void> {
        if (intent.state === 'queued') {
            const row = await this.#read((reads) => reads.readRegistryRow({ repo: intent.repo, pr: intent.pr }));
            if (row.kind !== 'row') return;
            if (row.status === 'abandoned' && row.prNumber !== null) {
                // Only the owner can repair this row; the coordinator has no way to.
                await this.escalate(
                    {
                        repo: intent.repo,
                        pr: intent.pr,
                        head: intent.head,
                        reason: 'registry-abandoned-with-pr',
                        to: 'owner',
                        body:
                            `${intent.repo}#${intent.pr} is merged, but its registry row reads abandoned while ` +
                            `carrying PR ${String(row.prNumber)}. The row needs an owner repair; the landed note waits.`,
                    },
                    now,
                );
                return;
            }
            if (row.status !== 'merged' || row.prNumber !== intent.pr) return;
        }
        await this.#deliver(intent, now);
    }

    /**
     * Note, landed note or escalation. The action id is looked up first, every
     * time: found → keep the receipt, absent → send, anything else → wait.
     */
    async #deliver(intent: Intent, now: number): Promise<DeliveryResult> {
        const id = intent.id;
        if (intent.state === 'done') {
            const kept = this.#state.receipt(id);
            return kept === null ? PENDING : { kind: 'delivered', receipt: kept };
        }
        const { taskId, addressee } = intent;
        if (intent.body === null) return PENDING;
        const body = `${intent.body}\n\naction-id: ${id}`;

        let found;
        let send: (writes: EffectWriter) => ReturnType<EffectWriter['deliverNote']>;
        if (intent.kind === 'escalation') {
            if (addressee === null) return PENDING;
            found = await this.#read((reads) => reads.findEscalation({ actionId: id }));
            send = (writes) =>
                writes.createEscalation({
                    actionId: id,
                    repo: intent.repo,
                    pr: intent.pr,
                    head: intent.head,
                    reason: intent.reason,
                    to: addressee,
                    body,
                });
        } else {
            if (taskId === null) return PENDING;
            found = await this.#read((reads) => reads.findDelivery({ taskId, actionId: id }));
            send = (writes) => writes.deliverNote({ actionId: id, taskId, body });
        }

        if (found.kind === 'found') return this.#keep(id, found.receipt, now);
        if (found.kind !== 'absent') return PENDING;
        const sent = await this.#perform(id, now, send);
        switch (sent.kind) {
            case 'sent':
                return this.#keep(id, sent.receipt, now);
            case 'dry-run':
                // A note or escalation is asked for again by the loop. A landed note is
                // queued once, by the merge, so a record-only adapter must not close it.
                if (intent.kind !== 'landed-note') this.#state.drop(id, 'dry-run', now);
                return { kind: 'dry-run' };
            default:
                return PENDING;
        }
    }

    #keep(id: string, receipt: unknown, now: number): DeliveryResult {
        if (typeof receipt !== 'string' || receipt === '') return PENDING;
        this.#state.recordReceipt(id, receipt, now);
        return { kind: 'delivered', receipt };
    }
}
