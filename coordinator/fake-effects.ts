/**
 * PR coordinator — a scripted effects adapter for tests (slice 3 of 4).
 *
 * It keeps a small model of the outside world (PRs, gate statuses, registry
 * rows, task comments, escalation tasks), records every call, and can be told
 * to fail the next call of any effect:
 *
 *   'lost-request'   throws before the effect happens;
 *   'lost-response'  the effect happens, then it throws (a crash after the call,
 *                    or a response that never arrived);
 *   { answer }       returns `answer` and changes nothing.
 */

import { READ_EFFECTS, WRITE_EFFECTS } from './effects';
import type {
    ApprovalRead,
    Effects,
    EscalationRequest,
    GateRead,
    GateResetRequest,
    Lookup,
    MergeOutcome,
    MergeRequest,
    NoteRequest,
    PrRead,
    PrRef,
    ReadEffect,
    RegistryRead,
    ResetOutcome,
    SendOutcome,
    WriteEffect,
} from './effects';

export type EffectName = ReadEffect | WriteEffect;
export type Fault = 'lost-request' | 'lost-response' | { answer: unknown };

export const EFFECT_NAMES = [...Object.keys(READ_EFFECTS), ...Object.keys(WRITE_EFFECTS)] as EffectName[];

const prKey = (ref: PrRef): string => `${ref.repo}#${ref.pr}`;
const gateKey = (at: { repo: string; head: string }): string => `${at.repo}@${at.head}`;

export class FakeEffects implements Effects {
    /** Every call, in order, reads included. */
    readonly calls: { effect: EffectName; request: unknown }[] = [];
    /** Runs at the start of every call, before anything happens. */
    onCall: ((effect: EffectName, request: unknown) => void) | null = null;

    // The world. A PR, gate or registry row nobody set reads `unknown`.
    readonly prs = new Map<string, PrRead>();
    readonly gates = new Map<string, GateRead['kind']>();
    readonly registry = new Map<string, RegistryRead>();
    /** Comments by `<taskId> <actionId>` → comment id. */
    readonly comments = new Map<string, string>();
    /** Escalation tasks by action id → task id. */
    readonly tasks = new Map<string, string>();
    /** Owner answers by escalation task id. One nobody set reads `unverified`. */
    readonly approvals = new Map<string, ApprovalRead['kind']>();
    /** Bodies actually posted, in order. */
    readonly posted: string[] = [];
    mergeCommit = 'e'.repeat(40);
    /** A merge leaves the gate status at `success` and reports it (`pr-status.sh` exit 3). */
    gateResetFails = false;

    readonly #faults = new Map<EffectName, Fault[]>();

    /** Queues a fault for the next call of `effect`. */
    failNext(effect: EffectName, fault: Fault): void {
        this.#faults.set(effect, [...(this.#faults.get(effect) ?? []), fault]);
    }

    /** The recorded calls of write effects only. */
    writes(): { effect: EffectName; request: unknown }[] {
        return this.calls.filter((call) => call.effect in WRITE_EFFECTS);
    }

    count(effect: EffectName): number {
        return this.calls.filter((call) => call.effect === effect).length;
    }

    #run<T>(effect: EffectName, request: unknown, apply: () => T): T {
        this.calls.push({ effect, request });
        this.onCall?.(effect, request);
        const fault = this.#faults.get(effect)?.shift();
        if (fault === 'lost-request') throw new Error(`${effect}: request lost`);
        if (fault !== undefined && fault !== 'lost-response') return fault.answer as T;
        const result = apply();
        if (fault === 'lost-response') throw new Error(`${effect}: response lost`);
        return result;
    }

    // ── Reads ──────────────────────────────────────────────────────────────

    async readPr(ref: PrRef): Promise<PrRead> {
        return this.#run('readPr', ref, () => this.prs.get(prKey(ref)) ?? { kind: 'unknown' });
    }

    async readGate(at: { repo: string; head: string }): Promise<GateRead> {
        return this.#run('readGate', at, () => ({ kind: this.gates.get(gateKey(at)) ?? 'unknown' }));
    }

    async readRegistryRow(ref: PrRef): Promise<RegistryRead> {
        return this.#run('readRegistryRow', ref, () => this.registry.get(prKey(ref)) ?? { kind: 'unknown' });
    }

    async findDelivery(query: { taskId: string; actionId: string }): Promise<Lookup> {
        return this.#run('findDelivery', query, () => {
            const receipt = this.comments.get(`${query.taskId} ${query.actionId}`);
            return receipt === undefined ? { kind: 'absent' } : { kind: 'found', receipt };
        });
    }

    async findEscalation(query: { actionId: string }): Promise<Lookup> {
        return this.#run('findEscalation', query, () => {
            const receipt = this.tasks.get(query.actionId);
            return receipt === undefined ? { kind: 'absent' } : { kind: 'found', receipt };
        });
    }

    async readApproval(query: { escalation: string }): Promise<ApprovalRead> {
        return this.#run('readApproval', query, () => ({ kind: this.approvals.get(query.escalation) ?? 'unverified' }));
    }

    // ── Writes ─────────────────────────────────────────────────────────────

    /** Merges only an open PR whose head is the pinned head; anything else is refused. */
    async merge(request: MergeRequest): Promise<MergeOutcome> {
        return this.#run('merge', request, () => {
            const pr = this.prs.get(prKey(request));
            if (pr === undefined || pr.kind !== 'open' || pr.head !== request.head) return { kind: 'refused' };
            this.prs.set(prKey(request), { kind: 'merged', head: request.head, mergeCommit: this.mergeCommit });
            this.gates.set(gateKey(request), this.gateResetFails ? 'success' : 'clear');
            return { kind: this.gateResetFails ? 'merged-gate-reset-failed' : 'merged', mergeCommit: this.mergeCommit };
        });
    }

    async resetGate(request: GateResetRequest): Promise<ResetOutcome> {
        return this.#run('resetGate', request, () => {
            this.gates.set(gateKey(request), 'clear');
            return { kind: 'reset' };
        });
    }

    async deliverNote(request: NoteRequest): Promise<SendOutcome> {
        return this.#run('deliverNote', request, () => {
            const receipt = `comment-${this.posted.length + 1}`;
            this.posted.push(request.body);
            this.comments.set(`${request.taskId} ${request.actionId}`, receipt);
            return { kind: 'sent', receipt };
        });
    }

    async createEscalation(request: EscalationRequest): Promise<SendOutcome> {
        return this.#run('createEscalation', request, () => {
            const receipt = `task-${this.posted.length + 1}`;
            this.posted.push(request.body);
            this.tasks.set(request.actionId, receipt);
            return { kind: 'sent', receipt };
        });
    }
}
