/**
 * PR coordinator — contract types for the decision core (slice 1 of 4).
 *
 * Everything here is plain data. The evidence readers (slice b) and the state
 * layer (slice c) fill a `PrSnapshot`; the loop (slice d) acts on a `Decision`.
 * This directory is run with Bun and is not part of the published npm package.
 */

// ── Closed sets ────────────────────────────────────────────────────────────

export const MODES = ['review-only', 'dry-run', 'live'] as const;
export type Mode = (typeof MODES)[number];

/** What triage can pick. */
export const TRIAGE_MODELS = ['luna', 'terra', 'sol'] as const;
export type TriageModel = (typeof TRIAGE_MODELS)[number];

/** A triage pick, or the fixed set a release PR gets. */
export const REVIEW_PICKS = ['luna', 'terra', 'sol', 'release'] as const;
export type ReviewPick = (typeof REVIEW_PICKS)[number];

export const VARIANTS = ['plain', 'second', 'vector'] as const;
export type Variant = (typeof VARIANTS)[number];

export const VERDICTS = ['APPROVE', 'COMMENT', 'REQUEST CHANGES'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CONFLICT_STATUSES = ['clean', 'conflict', 'blocked', 'incomplete', 'error'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

export const APPROVAL_STATES = ['approved', 'pending', 'denied', 'unverified'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const DEP_STATES = ['met', 'unmet', 'unknown'] as const;
export type DepState = (typeof DEP_STATES)[number];

export const PR_KINDS = ['change', 'release'] as const;
export type PrKind = (typeof PR_KINDS)[number];

// ── Input: one PR ──────────────────────────────────────────────────────────

/**
 * Triage output. The fallback line triage prints on any failure
 * (`<model> <effort> triage failed — default`) is `{ ok: false }`, never a pick.
 */
export type Triage =
    | { ok: true; model: TriageModel; effort: string; reason: string }
    | { ok: false };

/** One member of a review set: a variant run by a model family. */
export interface Member {
    variant: Variant;
    family: string;
}

/** A blocking finding. `id` must be unique among all runs at one head. */
export interface Finding {
    id: string;
}

/**
 * One completed review run, read from its review file. `headSha`, `family`,
 * `variant` and `runId` come from the runner-written provenance header, never
 * from model text. `schemaValid` is the file's schema check (Risk, Blocking,
 * Verdict); `verdict` may be null only when the schema is invalid.
 */
export interface ReviewRun {
    runId: string;
    headSha: string;
    family: string;
    variant: Variant;
    schemaValid: boolean;
    verdict: Verdict | null;
    blocking: Finding[];
}

/** An owner record retiring one finding at one head. */
export interface Retirement {
    headSha: string;
    findingId: string;
}

/**
 * One paid call in the attempt ledger (triage, review, verify …). It is charged
 * at `loggedCost` once the run completed and logged one, else at `reservation`.
 * `reservation` must be > 0, so a run with no logged cost is never free.
 */
export interface Attempt {
    headSha: string;
    reservation: number;
    loggedCost: number | null;
}

/**
 * The fields of the `conflicts --pr N --real --json` document that are checked.
 * A document with no verdict (`error`, `incomplete`) may name no shas.
 */
export interface ConflictsResult {
    status: ConflictStatus;
    pr: number | null;
    headSha: string | null;
    baseSha: string | null;
}

/** CI evidence over the required contexts. `testedBase` null = not exposed. */
export interface CiEvidence {
    headSha: string;
    complete: boolean;
    green: boolean;
    testedBase: string | null;
}

/**
 * The owner's approval: their server-stamped `approve` on the coordinator's
 * escalation task for this PR, bound to the head it was given for. Reading and
 * authenticating it is the evidence reader's job; here it is data.
 */
export interface OwnerApproval {
    state: ApprovalState;
    boundHead: string | null;
}

export interface PrSnapshot {
    /** Opaque repo identifier, echoed into merge decisions. */
    repo: string;
    pr: {
        number: number;
        draft: boolean;
        fork: boolean;
        kind: PrKind;
        /** Full 40-char lowercase head sha. */
        head: string;
        /** Full 40-char lowercase sha of the base branch right now. */
        base: string;
    };
    link: {
        taskOpen: boolean;
        claimantRegisteredBranch: boolean;
        coordinatorCreatedPr: boolean;
    };
    deps: {
        state: DepState;
        /** The task sits under a pipeline umbrella (scoped session decides). */
        pipelineUmbrella: boolean;
    };
    touches: {
        /** Trusted roots, the merge gate, the coordinator or its config. */
        protectedPaths: boolean;
        /** Paths whose merge triggers an effect (a deploy). */
        mergeEffects: boolean;
    };
    /** Owner approval of the merge-triggered effects; null = none requested. */
    effectsApproval: OwnerApproval | null;
    /** null = triage has not run at this head. */
    triage: Triage | null;
    /** Every completed review run known for this PR, any head. */
    reviews: ReviewRun[];
    retirements: Retirement[];
    /** The attempt ledger for this PR, any head. */
    attempts: Attempt[];
    /** When the blocking-findings note for this head was delivered (ms); null = not yet. */
    blockingNotifiedAt: number | null;
    ci: CiEvidence | null;
    conflicts: ConflictsResult | null;
}

/** What is reserved against the ceiling before each kind of paid run. Each > 0. */
export interface Reservations {
    triage: number;
    plain: number;
    second: number;
    vector: number;
}

/** A review-set member to run, with the amount to reserve for it. */
export interface DispatchedMember extends Member {
    reservation: number;
}

/** Per-repo policy. Nothing here has a built-in fleet value. */
export interface Policy {
    mode: Mode;
    /** Per-PR spend ceiling. */
    ceiling: number;
    /** Planned reservation per paid run; a run is dispatched only if it fits under the ceiling. */
    reservations: Reservations;
    /** Max reviewed heads per PR. */
    maxHeads: number;
    /** Model family that runs the `second` variant. */
    secondFamily: string;
    /** No new push this long after the note → escalate to the claimant. */
    stallClaimantMs: number;
    /** … this long → escalate to the owner. */
    stallOwnerMs: number;
    /** The repo's merge-triggered effects are classified. */
    effectsClassified: boolean;
    /** Live only: the merge-gate status is a required check on the base branch. */
    mergeGateApplied: boolean;
    /** Live only: the registry webhook is installed. */
    webhookInstalled: boolean;
}

export const DEFAULT_CEILING = 5.0;
export const DEFAULT_MAX_HEADS = 4;
export const DEFAULT_STALL_CLAIMANT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STALL_OWNER_MS = 72 * 60 * 60 * 1000;

// ── Output ─────────────────────────────────────────────────────────────────

/** Every decision kind with its closed set of reason codes. */
export const REASONS = {
    skip: ['draft'],
    escalate: [
        'invalid-snapshot',
        'invalid-policy',
        'invalid-clock',
        'fork',
        'release-not-coordinator-created',
        'self-authored-unsupported',
        'touches-protected-paths',
        'effects-approval-denied',
        'review-heads-exhausted',
        'budget-ceiling-reached',
        'second-approved',
        'request-changes-without-findings',
        'stalled-claimant',
        'stalled-owner',
    ],
    wait: [
        'deps-unmet',
        'deps-unknown',
        'pipeline-umbrella',
        'awaiting-effects-approval',
        'awaiting-author',
        'ci-incomplete',
        'ci-stale-head',
        'ci-base-unknown',
        'base-moved',
    ],
    'run-triage': ['triage-missing', 'triage-failed'],
    'run-reviews': ['review-set-incomplete'],
    notify: [
        'untrusted-task-link',
        'blocking-findings',
        'ci-red',
        'merge-conflict',
        'conflicts-blocked',
        'conflicts-unverified',
    ],
    ready: ['review-only-mode', 'effects-unclassified', 'live-prerequisites-missing'],
    'would-merge': ['clean-dry-run'],
    merge: ['clean-live'],
} as const;

export type DecisionKind = keyof typeof REASONS;
export type ReasonOf<K extends DecisionKind> = (typeof REASONS)[K][number];
export type Reason = ReasonOf<DecisionKind>;

/** A blocking finding that no owner record has retired at this head. */
export interface OpenFinding {
    runId: string;
    id: string;
}

/** What a merge (or would-merge) is pinned to. */
export interface MergeTarget {
    repo: string;
    pr: number;
    head: string;
    base: string;
}

export type Decision =
    | { kind: 'skip'; reason: ReasonOf<'skip'> }
    | {
          kind: 'escalate';
          reason: ReasonOf<'escalate'>;
          to: 'owner' | 'claimant';
          /** For the invalid-* reasons: the first field that failed validation. */
          field?: string;
      }
    | { kind: 'wait'; reason: ReasonOf<'wait'> }
    | { kind: 'run-triage'; reason: ReasonOf<'run-triage'>; reservation: number }
    /** `members`: the missing members that fit under the ceiling, in required order. */
    | { kind: 'run-reviews'; reason: ReasonOf<'run-reviews'>; pick: ReviewPick; members: DispatchedMember[] }
    | { kind: 'notify'; reason: ReasonOf<'notify'>; findings: OpenFinding[] }
    /** Passed every evidence gate, but policy does not merge it. */
    | ({ kind: 'ready'; reason: ReasonOf<'ready'> } & MergeTarget)
    | ({ kind: 'would-merge'; reason: ReasonOf<'would-merge'> } & MergeTarget)
    | ({ kind: 'merge'; reason: ReasonOf<'merge'> } & MergeTarget);

// ── Helper results ─────────────────────────────────────────────────────────

export interface ReviewSetState {
    required: Member[];
    missing: Member[];
    complete: boolean;
}

export interface BudgetState {
    /** False when the ledger, ceiling or head cap is malformed; then nothing may be spent. */
    valid: boolean;
    spent: number;
    admittedHeads: string[];
    headAdmitted: boolean;
    /** Why no new paid run may start, or null when one may. */
    blockedBy: 'invalid' | 'heads' | 'ceiling' | null;
}
