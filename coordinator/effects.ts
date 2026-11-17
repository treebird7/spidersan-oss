/**
 * PR coordinator — the effects adapter contract (slice 3 of 4).
 *
 * Everything the coordinator does outside its own database goes through an
 * `Effects` object: reads (`EffectReader`) and writes (`EffectWriter`). This
 * slice ships no adapter that talks to GitHub or invoak: only the record-only
 * `DryRunEffects` here and the scripted fake in `fake-effects.ts`.
 *
 * Every answer has an `unknown` member. A caller treats `unknown`, a thrown
 * error and any answer outside these sets the same way: nothing is concluded.
 *
 * Registry rule (mycsan, invoak #188): the coordinator reads registry rows and
 * never writes them. `EffectWriter` has no method that could attach, change or
 * clear a `prNumber`, or set a branch's status. Repairs are owner operations.
 */

import type { ApprovalState } from './types';

export interface PrRef {
    repo: string;
    pr: number;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** A pull request right now. All shas are full 40-char shas. */
export type PrRead =
    | { kind: 'open'; head: string; base: string }
    /** `head` is the head that was merged; `mergeCommit` the commit on the base branch. */
    | { kind: 'merged'; head: string; mergeCommit: string }
    /** Closed without merging. */
    | { kind: 'closed' }
    | { kind: 'unknown' };

/** The merge-gate commit status on one head: `success`, or anything else that is known. */
export type GateRead = { kind: 'success' } | { kind: 'clear' } | { kind: 'unknown' };

export const REGISTRY_STATUSES = ['active', 'merged', 'abandoned'] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

/**
 * invoak's branch-registry row for a PR. The real shape of this read is not
 * settled (invk-fosip); a reader that cannot verify a row answers `unknown`.
 * `absent` = no row carries this PR number (true of every open PR).
 */
export type RegistryRead =
    | { kind: 'row'; status: RegistryStatus; prNumber: number | null }
    | { kind: 'absent' }
    | { kind: 'unknown' };

/**
 * The owner's answer on one escalation task. How invoak exposes "who approved
 * a task" is not settled (invk-fosip): a reader answers `approved` or `denied`
 * only for a server-stamped owner action, and `unverified` for anything it
 * cannot authenticate. The states are slice 1's `APPROVAL_STATES`.
 */
export type ApprovalRead = { kind: ApprovalState } | { kind: 'unknown' };

/** Looking a delivery up by its action id. `receipt` is the comment or task id. */
export type Lookup = { kind: 'found'; receipt: string } | { kind: 'absent' } | { kind: 'unknown' };

export interface EffectReader {
    readPr(ref: PrRef): Promise<PrRead>;
    readGate(at: { repo: string; head: string }): Promise<GateRead>;
    readRegistryRow(ref: PrRef): Promise<RegistryRead>;
    /** Is there a comment on `taskId` whose body carries `actionId`? */
    findDelivery(query: { taskId: string; actionId: string }): Promise<Lookup>;
    /** Is there an escalation task carrying `actionId`? */
    findEscalation(query: { actionId: string }): Promise<Lookup>;
    /** `escalation` is the receipt (task id) of a created escalation. */
    readApproval(query: { escalation: string }): Promise<ApprovalRead>;
}

// ── Writes ─────────────────────────────────────────────────────────────────

/** Returned by an adapter that recorded the request and did nothing. */
export interface NotPerformed {
    kind: 'dry-run';
}

export type MergeOutcome =
    /** Merged at the pinned head, and the gate status was reset. */
    | { kind: 'merged'; mergeCommit: string }
    /** Merged, but the gate status is still `success` (`pr-status.sh` exit 3). */
    | { kind: 'merged-gate-reset-failed'; mergeCommit: string }
    /** Certainly not merged (the head moved, GitHub refused). */
    | { kind: 'refused' }
    | NotPerformed
    | { kind: 'unknown' };

export type ResetOutcome = { kind: 'reset' } | NotPerformed | { kind: 'unknown' };

export type SendOutcome = { kind: 'sent'; receipt: string } | NotPerformed | { kind: 'unknown' };

export interface MergeRequest extends PrRef {
    actionId: string;
    /** The merge is pinned to this head. */
    head: string;
}

export interface GateResetRequest {
    actionId: string;
    repo: string;
    head: string;
}

export interface NoteRequest {
    actionId: string;
    taskId: string;
    /** Already carries the action id. */
    body: string;
}

export interface EscalationRequest extends PrRef {
    actionId: string;
    head: string;
    reason: string;
    to: string;
    /** Already carries the action id. */
    body: string;
}

export interface EffectWriter {
    merge(request: MergeRequest): Promise<MergeOutcome>;
    resetGate(request: GateResetRequest): Promise<ResetOutcome>;
    deliverNote(request: NoteRequest): Promise<SendOutcome>;
    createEscalation(request: EscalationRequest): Promise<SendOutcome>;
}

export type Effects = EffectReader & EffectWriter;

/** Every write effect, by name. The compiler refuses a missing or an extra key. */
export const WRITE_EFFECTS = {
    merge: true,
    resetGate: true,
    deliverNote: true,
    createEscalation: true,
} as const satisfies Record<keyof EffectWriter, true>;
export type WriteEffect = keyof EffectWriter;

export const READ_EFFECTS = {
    readPr: true,
    readGate: true,
    readRegistryRow: true,
    findDelivery: true,
    findEscalation: true,
    readApproval: true,
} as const satisfies Record<keyof EffectReader, true>;
export type ReadEffect = keyof EffectReader;

// ── Dry run ────────────────────────────────────────────────────────────────

/**
 * Reads pass through to a reader; every write is recorded and answered
 * `dry-run`. It is built from an `EffectReader` and calls only that reader's
 * six read methods, so it contains no code path that performs a write.
 */
export class DryRunEffects implements Effects {
    readonly recorded: { effect: WriteEffect; request: unknown }[] = [];
    readonly readPr: EffectReader['readPr'];
    readonly readGate: EffectReader['readGate'];
    readonly readRegistryRow: EffectReader['readRegistryRow'];
    readonly findDelivery: EffectReader['findDelivery'];
    readonly findEscalation: EffectReader['findEscalation'];
    readonly readApproval: EffectReader['readApproval'];

    constructor(reads: EffectReader) {
        this.readPr = (ref) => reads.readPr(ref);
        this.readGate = (at) => reads.readGate(at);
        this.readRegistryRow = (ref) => reads.readRegistryRow(ref);
        this.findDelivery = (query) => reads.findDelivery(query);
        this.findEscalation = (query) => reads.findEscalation(query);
        this.readApproval = (query) => reads.readApproval(query);
    }

    #record(effect: WriteEffect, request: unknown): NotPerformed {
        this.recorded.push({ effect, request });
        return { kind: 'dry-run' };
    }

    async merge(request: MergeRequest): Promise<MergeOutcome> {
        return this.#record('merge', request);
    }

    async resetGate(request: GateResetRequest): Promise<ResetOutcome> {
        return this.#record('resetGate', request);
    }

    async deliverNote(request: NoteRequest): Promise<SendOutcome> {
        return this.#record('deliverNote', request);
    }

    async createEscalation(request: EscalationRequest): Promise<SendOutcome> {
        return this.#record('createEscalation', request);
    }
}
