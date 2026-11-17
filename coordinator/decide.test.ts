import { describe, expect, test } from 'bun:test';
import {
    blockingFindings,
    budgetState,
    conflictsClean,
    decide,
    fitsUnderCeiling,
    isFullSha,
    requiredMembers,
    reservationFor,
    resolveMode,
    reviewSetState,
    taskLinkTrusted,
} from './decide';
import {
    CONFLICT_STATUSES,
    DEFAULT_CEILING,
    DEFAULT_MAX_HEADS,
    DEFAULT_STALL_CLAIMANT_MS,
    DEFAULT_STALL_OWNER_MS,
    REASONS,
} from './types';
import type { Attempt, BudgetState, Decision, Mode, Policy, PrSnapshot, ReviewRun } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────

const sha = (c: string): string => c.repeat(40);
const HEAD = sha('a');
const BASE = sha('b');
const OTHER = sha('c');
/** Shares its first 7 characters with HEAD. */
const HEAD_SAME7 = 'aaaaaaa' + 'd'.repeat(33);
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const run = (over: Partial<ReviewRun> = {}): ReviewRun => ({
    runId: 'r1',
    headSha: HEAD,
    family: 'sol',
    variant: 'plain',
    schemaValid: true,
    verdict: 'COMMENT',
    blocking: [],
    ...over,
});

/**
 * A snapshot that passes every gate, loaded so that every field matters: a sol
 * pick (three members), merge effects approved at head, and one blocking
 * finding that an owner record retires.
 */
function clean(): PrSnapshot {
    return {
        repo: 'owner/name',
        pr: { number: 42, draft: false, fork: false, kind: 'change', head: HEAD, base: BASE },
        link: { taskOpen: true, claimantRegisteredBranch: true, coordinatorCreatedPr: false },
        deps: { state: 'met', pipelineUmbrella: false },
        touches: { protectedPaths: false, mergeEffects: true },
        effectsApproval: { state: 'approved', boundHead: HEAD },
        triage: { ok: true, model: 'sol', effort: 'high', reason: 'touches auth' },
        reviews: [
            run({ runId: 'r1', variant: 'plain', blocking: [{ id: 'f1' }] }),
            run({ runId: 'r2', variant: 'vector', verdict: 'APPROVE' }),
            run({ runId: 'r3', variant: 'second', family: 'haiku' }),
        ],
        retirements: [{ headSha: HEAD, findingId: 'f1' }],
        attempts: [
            { headSha: HEAD, reservation: 1, loggedCost: 0.4 },
            { headSha: HEAD, reservation: 1, loggedCost: null },
        ],
        blockingNotifiedAt: null,
        ci: { headSha: HEAD, complete: true, green: true, testedBase: BASE },
        conflicts: { status: 'clean', pr: 42, headSha: HEAD, baseSha: BASE },
    };
}

function policy(mode: Mode = 'dry-run'): Policy {
    return {
        mode,
        ceiling: DEFAULT_CEILING,
        maxHeads: DEFAULT_MAX_HEADS,
        reservations: { triage: 0.1, plain: 1, second: 0.25, vector: 1 },
        secondFamily: 'haiku',
        stallClaimantMs: DEFAULT_STALL_CLAIMANT_MS,
        stallOwnerMs: DEFAULT_STALL_OWNER_MS,
        effectsClassified: true,
        mergeGateApplied: true,
        webhookInstalled: true,
    };
}

/** A terra-pick variant of the clean snapshot (primary + second). */
function cleanTerra(): PrSnapshot {
    const s = clean();
    s.triage = { ok: true, model: 'terra', effort: 'high', reason: 'x' };
    s.reviews = [run({ runId: 'r1', family: 'terra' }), run({ runId: 'r3', variant: 'second', family: 'haiku' })];
    s.retirements = [];
    return s;
}

/**
 * The other route to a merge: a release PR the coordinator created. No triage,
 * the release set (terra primary + second), link trusted by creation record.
 */
function cleanRelease(): PrSnapshot {
    const s = clean();
    s.pr.kind = 'release';
    s.link = { taskOpen: true, claimantRegisteredBranch: false, coordinatorCreatedPr: true };
    s.triage = null;
    s.reviews = [
        run({ runId: 'r1', family: 'terra', blocking: [{ id: 'f1' }] }),
        run({ runId: 'r3', variant: 'second', family: 'haiku' }),
    ];
    return s;
}

// Every reason any test produced, for the coverage check at the end.
const seen = new Set<string>();
function d(s: unknown, ...rest: unknown[]): Decision {
    // Explicit `undefined` arguments are passed through, not defaulted.
    const p = rest.length > 0 ? rest[0] : policy();
    const now = rest.length > 1 ? rest[1] : NOW;
    const decision = decide(s as PrSnapshot, p as Policy, now as number);
    seen.add(`${decision.kind}/${decision.reason}`);
    return decision;
}
const merges = (decision: Decision): boolean => decision.kind === 'merge' || decision.kind === 'would-merge';

// ── Helpers ────────────────────────────────────────────────────────────────

describe('isFullSha', () => {
    test('accepts only 40 lowercase hex characters', () => {
        expect(isFullSha(HEAD)).toBe(true);
        for (const bad of [HEAD.slice(0, 39), HEAD + 'a', HEAD.toUpperCase(), HEAD + '\n', 'aaaaaaa', '', null, 7]) {
            expect(isFullSha(bad)).toBe(false);
        }
    });
});

describe('resolveMode', () => {
    test('a repo missing from config, or with an unknown mode, is review-only', () => {
        expect(resolveMode({ 'o/a': 'live', 'o/b': 'dry-run' }, 'o/a')).toBe('live');
        expect(resolveMode({ 'o/a': 'live' }, 'o/b')).toBe('review-only');
        expect(resolveMode({ 'o/a': 'LIVE' }, 'o/a')).toBe('review-only');
        expect(resolveMode({}, 'constructor')).toBe('review-only');
        expect(resolveMode(undefined, 'o/a')).toBe('review-only');
        expect(resolveMode(null, 'o/a')).toBe('review-only');
    });
});

describe('requiredMembers', () => {
    test('the review-set table', () => {
        expect(requiredMembers('luna', 'haiku')).toEqual([{ variant: 'plain', family: 'luna' }]);
        expect(requiredMembers('terra', 'haiku')).toEqual([
            { variant: 'plain', family: 'terra' },
            { variant: 'second', family: 'haiku' },
        ]);
        expect(requiredMembers('sol', 'haiku')).toEqual([
            { variant: 'plain', family: 'sol' },
            { variant: 'vector', family: 'sol' },
            { variant: 'second', family: 'haiku' },
        ]);
        expect(requiredMembers('release', 'haiku')).toEqual([
            { variant: 'plain', family: 'terra' },
            { variant: 'second', family: 'haiku' },
        ]);
    });

    test('an unknown pick or empty second family requires nothing and is never complete', () => {
        for (const pick of ['flash', 'constructor', '__proto__', '', undefined, null]) {
            expect(requiredMembers(pick as never, 'haiku')).toEqual([]);
            expect(reviewSetState(pick as never, [run()], HEAD, 'haiku').complete).toBe(false);
        }
        expect(requiredMembers('terra', '')).toEqual([]);
        expect(reviewSetState('luna', [run({ family: 'luna' })], HEAD, '').complete).toBe(false);
    });
});

describe('reviewSetState', () => {
    const second = run({ runId: 'r3', variant: 'second', family: 'haiku' });

    test('luna is complete with a primary alone', () => {
        expect(reviewSetState('luna', [run({ family: 'luna' })], HEAD, 'haiku').complete).toBe(true);
    });

    test('a primary-only set is rejected for terra and sol', () => {
        const terra = reviewSetState('terra', [run({ family: 'terra' })], HEAD, 'haiku');
        expect(terra.complete).toBe(false);
        expect(terra.missing).toEqual([{ variant: 'second', family: 'haiku' }]);
        const sol = reviewSetState('sol', [run({ family: 'sol' })], HEAD, 'haiku');
        expect(sol.complete).toBe(false);
        expect(sol.missing).toEqual([
            { variant: 'vector', family: 'sol' },
            { variant: 'second', family: 'haiku' },
        ]);
    });

    test('a second-only set is rejected', () => {
        for (const pick of ['luna', 'terra', 'sol', 'release'] as const) {
            expect(reviewSetState(pick, [second], HEAD, 'haiku').complete).toBe(false);
        }
    });

    test('sol without its vector is rejected; the full set is complete', () => {
        expect(reviewSetState('sol', [run(), second], HEAD, 'haiku').complete).toBe(false);
        const full = [run(), run({ runId: 'r2', variant: 'vector' }), second];
        expect(reviewSetState('sol', full, HEAD, 'haiku').complete).toBe(true);
    });

    test('a release set needs a terra primary, whatever else exists', () => {
        expect(reviewSetState('release', [run({ family: 'sol' }), second], HEAD, 'haiku').complete).toBe(false);
        expect(reviewSetState('release', [run({ family: 'terra' }), second], HEAD, 'haiku').complete).toBe(true);
    });

    test('a member whose header sha differs from the head is not counted, same first 7 or not', () => {
        expect(HEAD_SAME7.slice(0, 7)).toBe(HEAD.slice(0, 7));
        for (const headSha of [HEAD_SAME7, OTHER, HEAD.slice(0, 7), HEAD.toUpperCase()]) {
            const state = reviewSetState('luna', [run({ family: 'luna', headSha })], HEAD, 'haiku');
            expect(state.complete).toBe(false);
        }
    });

    test('a member with the wrong family, wrong variant or an invalid schema is not counted', () => {
        expect(reviewSetState('luna', [run({ family: 'terra' })], HEAD, 'haiku').complete).toBe(false);
        expect(reviewSetState('luna', [run({ family: 'luna', variant: 'vector' })], HEAD, 'haiku').complete).toBe(false);
        expect(reviewSetState('luna', [run({ family: 'luna', schemaValid: false })], HEAD, 'haiku').complete).toBe(false);
        expect(reviewSetState('luna', [run({ family: 'luna', verdict: null })], HEAD, 'haiku').complete).toBe(false);
        expect(reviewSetState('terra', [run({ family: 'terra' }), run({ variant: 'second', family: 'luna' })], HEAD, 'haiku').complete).toBe(false);
    });

    test('a non-array review list is an empty one', () => {
        expect(reviewSetState('luna', null as never, HEAD, 'haiku').complete).toBe(false);
    });
});

describe('blockingFindings', () => {
    const withFinding = run({ runId: 'r1', verdict: 'REQUEST CHANGES', blocking: [{ id: 'f1' }] });
    const laterApprove = run({ runId: 'r2', verdict: 'APPROVE' });

    test('a later APPROVE does not clear an earlier run\'s finding', () => {
        expect(blockingFindings([withFinding, laterApprove], [], HEAD)).toEqual([{ runId: 'r1', id: 'f1' }]);
    });

    test('an owner retirement at this head clears it', () => {
        expect(blockingFindings([withFinding, laterApprove], [{ headSha: HEAD, findingId: 'f1' }], HEAD)).toEqual([]);
    });

    test('a retirement for another head, or another finding, does not', () => {
        expect(blockingFindings([withFinding], [{ headSha: OTHER, findingId: 'f1' }], HEAD)).toHaveLength(1);
        expect(blockingFindings([withFinding], [{ headSha: HEAD_SAME7, findingId: 'f1' }], HEAD)).toHaveLength(1);
        expect(blockingFindings([withFinding], [{ headSha: HEAD, findingId: 'f2' }], HEAD)).toHaveLength(1);
    });

    test('findings of every run at this head count; findings at another head do not', () => {
        const runs = [
            withFinding,
            run({ runId: 'r2', variant: 'vector', blocking: [{ id: 'f2' }] }),
            run({ runId: 'r9', schemaValid: false, verdict: null, blocking: [{ id: 'f3' }] }),
            run({ runId: 'r0', headSha: OTHER, blocking: [{ id: 'old' }] }),
        ];
        expect(blockingFindings(runs, [], HEAD).map((f) => f.id)).toEqual(['f1', 'f2', 'f3']);
    });
});

describe('blockingFindings: malformed input', () => {
    const withFinding = run({ blocking: [{ id: 'f1' }] });
    test('a head that is not a full sha is refused, not answered with an empty list', () => {
        for (const head of ['aaaaaaa', HEAD.toUpperCase(), HEAD + '\n', '', undefined]) {
            expect(blockingFindings([withFinding], [], head as never)).toBeNull();
        }
    });
    test('a non-array list or a malformed entry is refused', () => {
        expect(blockingFindings(null as never, [], HEAD)).toBeNull();
        expect(blockingFindings([withFinding], undefined as never, HEAD)).toBeNull();
        expect(blockingFindings([{ ...withFinding, blocking: undefined } as never], [], HEAD)).toBeNull();
        expect(blockingFindings([{ ...withFinding, blocking: [{}] } as never], [], HEAD)).toBeNull();
        expect(blockingFindings([{ ...withFinding, headSha: 'aaaaaaa' }], [], HEAD)).toBeNull();
        expect(blockingFindings([null as never], [], HEAD)).toBeNull();
        expect(blockingFindings([withFinding], [{ headSha: HEAD } as never], HEAD)).toBeNull();
    });
    test('called directly it does not reject a shared finding id: one retirement retires both', () => {
        const two = [withFinding, run({ runId: 'r2', variant: 'vector', blocking: [{ id: 'f1' }] })];
        expect(blockingFindings(two, [], HEAD)).toHaveLength(2);
        expect(blockingFindings(two, [{ headSha: HEAD, findingId: 'f1' }], HEAD)).toEqual([]);
    });
});

describe('conflictsClean', () => {
    const expected = { pr: 42, head: HEAD, base: BASE };
    const doc = { status: 'clean', pr: 42, headSha: HEAD, baseSha: BASE };

    test('clean for this pr, head and base', () => {
        expect(conflictsClean(doc, expected)).toBe(true);
    });

    test('every non-clean status is not clean, incomplete included', () => {
        for (const status of CONFLICT_STATUSES) {
            if (status === 'clean') continue;
            expect(conflictsClean({ ...doc, status }, expected)).toBe(false);
        }
        expect(conflictsClean({ ...doc, status: 'CLEAN' }, expected)).toBe(false);
        expect(conflictsClean({ ...doc, status: undefined }, expected)).toBe(false);
    });

    test('a clean status for a different head, base or pr is not clean', () => {
        expect(conflictsClean({ ...doc, headSha: OTHER }, expected)).toBe(false);
        expect(conflictsClean({ ...doc, headSha: HEAD_SAME7 }, expected)).toBe(false);
        expect(conflictsClean({ ...doc, headSha: HEAD.slice(0, 7) }, expected)).toBe(false);
        expect(conflictsClean({ ...doc, baseSha: OTHER }, expected)).toBe(false);
        expect(conflictsClean({ ...doc, pr: 43 }, expected)).toBe(false);
        expect(conflictsClean({ ...doc, pr: '42' }, expected)).toBe(false);
    });

    test('a missing or unparseable document is not clean', () => {
        for (const bad of [null, undefined, '', 'clean', 0, [], {}, { status: 'clean' }]) {
            expect(conflictsClean(bad, expected)).toBe(false);
        }
    });

    test('a malformed expectation is not clean either', () => {
        const short = { status: 'clean', pr: 42, headSha: 'aaaaaaa', baseSha: BASE };
        expect(conflictsClean(short, { pr: 42, head: 'aaaaaaa', base: BASE })).toBe(false);
        expect(conflictsClean({ ...doc, pr: undefined }, { pr: undefined as never, head: HEAD, base: BASE })).toBe(false);
    });
});

describe('budgetState', () => {
    const limits = { ceiling: 5, maxHeads: 4 };
    const at = (headSha: string, reservation: number, loggedCost: number | null = null): Attempt => ({
        headSha,
        reservation,
        loggedCost,
    });

    test('a logged cost replaces the reservation instead of adding to it', () => {
        expect(budgetState([at(HEAD, 2)], limits, HEAD).spent).toBe(2);
        expect(budgetState([at(HEAD, 2, 0.5)], limits, HEAD).spent).toBe(0.5);
        expect(budgetState([at(HEAD, 2, 0)], limits, HEAD).spent).toBe(0);
    });

    test('a run with no logged cost (failed or unknown) stays charged at its reservation', () => {
        const state = budgetState([at(HEAD, 1.5), at(HEAD, 1, 0.25), at(HEAD, 1.5)], limits, HEAD);
        expect(state.spent).toBe(3.25);
        expect(state.blockedBy).toBeNull();
    });

    test('a fifth head is blocked; an admitted head is not', () => {
        const four = ['1', '2', '3', '4'].map((c) => at(sha(c), 0.1, 0.1));
        expect(budgetState(four, limits, HEAD).blockedBy).toBe('heads');
        expect(budgetState(four, limits, HEAD).headAdmitted).toBe(false);
        expect(budgetState(four, limits, sha('4')).blockedBy).toBeNull();
        expect(budgetState(four.slice(0, 3), limits, HEAD).blockedBy).toBeNull();
    });

    test('spend at or over the ceiling is blocked, also for an admitted head', () => {
        expect(budgetState([at(HEAD, 5)], limits, HEAD).blockedBy).toBe('ceiling');
        expect(budgetState([at(HEAD, 3, 2.5), at(HEAD, 3)], limits, HEAD).blockedBy).toBe('ceiling');
        expect(budgetState([at(HEAD, 4.99)], limits, HEAD).blockedBy).toBeNull();
    });

    test('a malformed ledger or limit blocks everything', () => {
        const bad: unknown[][] = [
            [at(HEAD, Number.NaN)],
            [at(HEAD, -1)],
            [at(HEAD, 0)],
            [at(HEAD, 0, 0.5)],
            [at(HEAD, 1, Number.NaN)],
            [at(HEAD, 1, Number.POSITIVE_INFINITY)],
            [at('aaaaaaa', 1)],
            [{ headSha: HEAD, reservation: '1', loggedCost: null }],
            [{ headSha: HEAD, reservation: 1 }],
            [null],
        ];
        for (const attempts of bad) expect(budgetState(attempts, limits, HEAD).blockedBy).toBe('invalid');
        expect(budgetState(null as never, limits, HEAD).blockedBy).toBe('invalid');
        expect(budgetState([], { ceiling: Number.NaN, maxHeads: 4 }, HEAD).blockedBy).toBe('invalid');
        expect(budgetState([], { ceiling: 0, maxHeads: 4 }, HEAD).blockedBy).toBe('invalid');
        expect(budgetState([], { ceiling: 5, maxHeads: 0 }, HEAD).blockedBy).toBe('invalid');
        expect(budgetState([], { ceiling: 5, maxHeads: 1.5 }, HEAD).blockedBy).toBe('invalid');
        expect(budgetState([], limits, 'aaaaaaa').blockedBy).toBe('invalid');
    });
});

describe('reservationFor / fitsUnderCeiling', () => {
    const reservations = { triage: 0.1, plain: 1, second: 0.25, vector: 2 };
    const budget = (spent: number): BudgetState => budgetState([{ headSha: HEAD, reservation: 9, loggedCost: spent }], { ceiling: 5, maxHeads: 4 }, HEAD);

    test('reservationFor returns the planned amount, or null when it is not > 0 or the run is unknown', () => {
        expect(reservationFor('triage', reservations)).toBe(0.1);
        expect(reservationFor('vector', reservations)).toBe(2);
        expect(reservationFor('plain', { ...reservations, plain: 0 })).toBeNull();
        expect(reservationFor('second', { ...reservations, second: Number.NaN })).toBeNull();
        expect(reservationFor('constructor' as never, reservations)).toBeNull();
        expect(reservationFor('plain', null as never)).toBeNull();
    });

    test('fitsUnderCeiling counts the longest prefix with spent + Σ ≤ ceiling', () => {
        expect(fitsUnderCeiling(budget(4.99), 5, [1])).toBe(0);
        expect(fitsUnderCeiling(budget(4), 5, [1])).toBe(1);
        expect(fitsUnderCeiling(budget(4), 5, [1, 0.25])).toBe(1);
        expect(fitsUnderCeiling(budget(3), 5, [1, 0.25, 0.75])).toBe(3);
        expect(fitsUnderCeiling(budget(4), 5, [2, 0.25])).toBe(0);
        expect(fitsUnderCeiling(budget(1), 5, [])).toBe(0);
    });

    test('fitsUnderCeiling is 0 for a blocked or malformed budget, ceiling or plan', () => {
        expect(fitsUnderCeiling(budget(5), 5, [0.1])).toBe(0);
        expect(fitsUnderCeiling(budgetState(null as never, { ceiling: 5, maxHeads: 4 }, HEAD), 5, [0.1])).toBe(0);
        expect(fitsUnderCeiling(null as never, 5, [0.1])).toBe(0);
        expect(fitsUnderCeiling(budget(1), Number.NaN, [0.1])).toBe(0);
        expect(fitsUnderCeiling(budget(1), 5, [0])).toBe(0);
        expect(fitsUnderCeiling(budget(1), 5, [Number.NaN, 1])).toBe(0);
        expect(fitsUnderCeiling(budget(1), 5, [1, -1, 1])).toBe(1);
        expect(fitsUnderCeiling(budget(1), 5, null as never)).toBe(0);
    });
});

describe('taskLinkTrusted', () => {
    const link = { taskOpen: true, claimantRegisteredBranch: true, coordinatorCreatedPr: false };
    test('needs: not a fork, task open, and claimant-registered or coordinator-created', () => {
        expect(taskLinkTrusted(false, link)).toBe(true);
        expect(taskLinkTrusted(false, { ...link, claimantRegisteredBranch: false, coordinatorCreatedPr: true })).toBe(true);
        expect(taskLinkTrusted(true, link)).toBe(false);
        expect(taskLinkTrusted(false, { ...link, taskOpen: false })).toBe(false);
        expect(taskLinkTrusted(false, { ...link, claimantRegisteredBranch: false })).toBe(false);
        expect(taskLinkTrusted(false, { ...link, taskOpen: 'true' as never })).toBe(false);
        expect(taskLinkTrusted(false, null as never)).toBe(false);
    });
});

// ── decide ─────────────────────────────────────────────────────────────────

describe('decide: mode', () => {
    const target = { repo: 'owner/name', pr: 42, head: HEAD, base: BASE };

    test('the clean snapshot is would-merge in dry-run', () => {
        expect(d(clean(), policy('dry-run'))).toEqual({ kind: 'would-merge', reason: 'clean-dry-run', ...target });
    });

    test('… merge in live', () => {
        expect(d(clean(), policy('live'))).toEqual({ kind: 'merge', reason: 'clean-live', ...target });
    });

    test('… and a non-merging ready in review-only', () => {
        expect(d(clean(), policy('review-only'))).toEqual({ kind: 'ready', reason: 'review-only-mode', ...target });
    });

    test('unclassified effects: ready, not merged, in dry-run and live', () => {
        for (const mode of ['dry-run', 'live'] as const) {
            const decision = d(clean(), { ...policy(mode), effectsClassified: false });
            expect(decision).toEqual({ kind: 'ready', reason: 'effects-unclassified', ...target });
        }
    });

    test('live without the merge gate or the webhook: ready, not merged', () => {
        for (const missing of ['mergeGateApplied', 'webhookInstalled'] as const) {
            const decision = d(clean(), { ...policy('live'), [missing]: false });
            expect(decision).toEqual({ kind: 'ready', reason: 'live-prerequisites-missing', ...target });
        }
    });

    test('the terra and luna variants of the clean snapshot merge too', () => {
        expect(d(cleanTerra(), policy('live')).kind).toBe('merge');
        const luna = cleanTerra();
        luna.triage = { ok: true, model: 'luna', effort: 'medium', reason: 'x' };
        luna.reviews = [run({ family: 'luna' })];
        expect(d(luna, policy('live')).kind).toBe('merge');
    });
});

interface Ctx {
    s: PrSnapshot;
    p: Policy;
    now: number;
}
type Break = (c: Ctx) => void;
/** Rows marked `true` must give the same reason when the task link is untrusted. */
const ANY_LINK = true;

/**
 * The loop, in order. Each row breaks one gate. Row i is run with its own break
 * AND every later row's break applied, so it only yields its reason if its gate
 * is consulted before all the later ones.
 */
const ORDERED: Array<[kind: string, reason: string, brk: Break, anyLink?: boolean]> = [
    ['escalate', 'invalid-snapshot', (c) => void ((c.s.pr as { number: unknown }).number = 0), ANY_LINK],
    ['skip', 'draft', (c) => void (c.s.pr.draft = true), ANY_LINK],
    ['escalate', 'fork', (c) => void (c.s.pr.fork = true), ANY_LINK],
    ['escalate', 'invalid-snapshot', (c) => void (c.s.blockingNotifiedAt = -1), ANY_LINK],
    ['escalate', 'invalid-policy', (c) => void (c.p.ceiling = Number.NaN), ANY_LINK],
    ['escalate', 'invalid-clock', (c) => void (c.now = Number.NaN), ANY_LINK],
    ['escalate', 'self-authored-unsupported', (c) => void (c.s.link.coordinatorCreatedPr = true), ANY_LINK],
    // Before the link check: escalates whatever the link says, before any paid run.
    ['escalate', 'touches-protected-paths', (c) => void (c.s.touches.protectedPaths = true), ANY_LINK],
    ['wait', 'deps-unmet', (c) => void (c.s.deps.state = 'unmet')],
    ['wait', 'pipeline-umbrella', (c) => void (c.s.deps.pipelineUmbrella = true)],
    [
        'escalate',
        'review-heads-exhausted',
        (c) => void (c.s.attempts = ['1', '2', '3', '4'].map((x) => ({ headSha: sha(x), reservation: 9, loggedCost: null }))),
        ANY_LINK,
    ],
    // The budget check comes before any paid run, triage included.
    ['run-triage', 'triage-missing', (c) => void (c.s.triage = null), ANY_LINK],
    ['run-reviews', 'review-set-incomplete', (c) => void (c.s.reviews = c.s.reviews.filter((r) => r.variant !== 'vector')), ANY_LINK],
    ['escalate', 'second-approved', (c) => void (c.s.reviews.find((r) => r.variant === 'second')!.verdict = 'APPROVE'), ANY_LINK],
    [
        'escalate',
        'request-changes-without-findings',
        (c) => void (c.s.reviews.find((r) => r.runId === 'r2')!.verdict = 'REQUEST CHANGES'),
        ANY_LINK,
    ],
    ['notify', 'blocking-findings', (c) => void (c.s.retirements = [])],
    ['wait', 'ci-stale-head', (c) => void (c.s.ci!.headSha = HEAD_SAME7)],
    ['wait', 'ci-incomplete', (c) => void (c.s.ci!.complete = false)],
    ['notify', 'ci-red', (c) => void (c.s.ci!.green = false)],
    ['notify', 'merge-conflict', (c) => void (c.s.conflicts!.status = 'conflict')],
    ['wait', 'ci-base-unknown', (c) => void (c.s.ci!.testedBase = null)],
    ['ready', 'effects-unclassified', (c) => void (c.p.effectsClassified = false)],
    ['ready', 'live-prerequisites-missing', (c) => void (c.p.mergeGateApplied = false)],
    // Owner approval of merge-triggered effects is the last thing asked for.
    ['wait', 'awaiting-effects-approval', (c) => void (c.s.effectsApproval = null)],
];

describe('decide: the ordered loop', () => {
    for (let i = 0; i < ORDERED.length; i++) {
        const [kind, reason] = ORDERED[i]!;
        test(`gate ${i + 1}: ${kind}/${reason} wins over every later gate`, () => {
            const c: Ctx = { s: clean(), p: policy('live'), now: NOW };
            // Later breaks first, so a break that replaces a list sees the others' edits.
            for (let j = ORDERED.length - 1; j >= i; j--) ORDERED[j]![2](c);
            const decision = d(c.s, c.p, c.now);
            expect(`${decision.kind}/${decision.reason}`).toBe(`${kind}/${reason}`);
        });

        if (ORDERED[i]![3] === true) {
            for (const untrust of [
                (c: Ctx) => void (c.s.link.taskOpen = false),
                (c: Ctx) => void (c.s.link.claimantRegisteredBranch = false),
            ]) {
                test(`gate ${i + 1}: ${kind}/${reason} also wins when the task link is untrusted`, () => {
                    const c: Ctx = { s: clean(), p: policy('live'), now: NOW };
                    for (let j = ORDERED.length - 1; j >= i; j--) ORDERED[j]![2](c);
                    untrust(c);
                    const decision = d(c.s, c.p, c.now);
                    expect(`${decision.kind}/${decision.reason}`).toBe(`${kind}/${reason}`);
                });
            }
        }

        test(`gate ${i + 1}: ${kind}/${reason} alone, on an otherwise clean snapshot`, () => {
            const c: Ctx = { s: clean(), p: policy('live'), now: NOW };
            ORDERED[i]![2](c);
            const decision = d(c.s, c.p, c.now);
            // Exhausted heads only bite once a paid run is needed.
            if (reason === 'review-heads-exhausted') {
                expect(decision.kind).toBe('merge'); // the set is complete: no run is needed
            } else {
                expect(`${decision.kind}/${decision.reason}`).toBe(`${kind}/${reason}`);
            }
        });
    }
});

describe('decide: each gate\'s other outcomes', () => {
    const expectReason = (decision: Decision, kind: string, reason: string): void => {
        expect(`${decision.kind}/${decision.reason}`).toBe(`${kind}/${reason}`);
    };
    const mut = (f: (s: PrSnapshot) => void, base: () => PrSnapshot = clean): PrSnapshot => {
        const s = base();
        f(s);
        return s;
    };

    test('a draft or a fork is decided before the rest of the snapshot is validated', () => {
        const junk = { repo: 'owner/name', pr: { ...clean().pr, draft: true } };
        expectReason(d(junk), 'skip', 'draft');
        const fork = { repo: 'owner/name', pr: { ...clean().pr, fork: true } };
        expectReason(d(fork), 'escalate', 'fork');
    });

    test('invalid-* escalations name the field', () => {
        expect(d(mut((s) => void (s.deps.state = 'maybe' as never)))).toEqual({
            kind: 'escalate',
            reason: 'invalid-snapshot',
            to: 'owner',
            field: 'deps.state',
        });
        expect(d(clean(), { ...policy(), mode: 'yolo' })).toMatchObject({ reason: 'invalid-policy', field: 'mode' });
        expect(d(clean(), { ...policy(), stallOwnerMs: 1 })).toMatchObject({ reason: 'invalid-policy', field: 'stallOwnerMs' });
        expect(d(clean(), policy(), '5')).toMatchObject({ reason: 'invalid-clock', field: 'now' });
        expect(d(null)).toMatchObject({ reason: 'invalid-snapshot', field: 'snapshot' });
        expect(d(clean(), null)).toMatchObject({ reason: 'invalid-policy', field: 'policy' });
    });

    test('each malformed policy field is invalid-policy, naming the field', () => {
        const bad: Array<[keyof Policy, unknown]> = [
            ['ceiling', 0],
            ['ceiling', -1],
            ['ceiling', Number.POSITIVE_INFINITY],
            ['maxHeads', 0],
            ['maxHeads', 1.5],
            ['secondFamily', ''],
            ['stallClaimantMs', -1],
            ['stallOwnerMs', Number.NaN],
            ['effectsClassified', 'yes'],
            ['mergeGateApplied', 1],
            ['webhookInstalled', null],
        ];
        for (const [field, value] of bad) {
            for (const mode of ['dry-run', 'live'] as const) {
                expect(d(clean(), { ...policy(mode), [field]: value })).toEqual({
                    kind: 'escalate',
                    reason: 'invalid-policy',
                    to: 'owner',
                    field,
                });
            }
        }
    });

    test('two findings sharing an id at one head, or two runs sharing a run id, are an invalid snapshot', () => {
        const dupFinding = mut((s) => void (s.reviews[1]!.blocking = [{ id: 'f1' }]));
        expect(d(dupFinding)).toMatchObject({ reason: 'invalid-snapshot', field: 'reviews[1].blocking[0].id' });
        const dupRun = mut((s) => void (s.reviews[1]!.runId = 'r1'));
        expect(d(dupRun)).toMatchObject({ reason: 'invalid-snapshot', field: 'reviews[1].runId' });
    });

    test('a release PR the coordinator did not create escalates', () => {
        expectReason(d(mut((s) => void (s.pr.kind = 'release'))), 'escalate', 'release-not-coordinator-created');
    });

    test('a release PR the coordinator created needs the release set, with no triage', () => {
        const release = (): PrSnapshot =>
            mut((s) => {
                s.pr.kind = 'release';
                s.link.coordinatorCreatedPr = true;
                s.link.claimantRegisteredBranch = false;
                s.triage = { ok: false };
            }, cleanTerra);
        expect(d(release(), policy('live')).kind).toBe('merge');
        // A sol primary is not the terra primary the release set requires.
        const wrongPrimary = release();
        wrongPrimary.reviews[0]!.family = 'sol';
        expect(d(wrongPrimary, policy('live'))).toMatchObject({
            kind: 'run-reviews',
            pick: 'release',
            members: [{ variant: 'plain', family: 'terra' }],
        });
    });

    test('an untrusted task link is reviewed and notified, never merged', () => {
        for (const brk of [
            (s: PrSnapshot) => void (s.link.taskOpen = false),
            (s: PrSnapshot) => void (s.link.claimantRegisteredBranch = false),
        ]) {
            for (const mode of ['review-only', 'dry-run', 'live'] as const) {
                expect(d(mut(brk), policy(mode))).toEqual({ kind: 'notify', reason: 'untrusted-task-link', findings: [] });
            }
        }
    });

    test('an untrusted link still runs the review stage, and reports the open findings', () => {
        const untrusted = (f: (s: PrSnapshot) => void): PrSnapshot =>
            mut((s) => {
                s.link.taskOpen = false;
                f(s);
            });
        expectReason(d(untrusted((s) => void (s.triage = { ok: false }))), 'run-triage', 'triage-failed');
        expectReason(d(untrusted((s) => void s.reviews.pop())), 'run-reviews', 'review-set-incomplete');
        expectReason(
            d(untrusted((s) => void (s.reviews[1]!.verdict = 'REQUEST CHANGES'))),
            'escalate',
            'request-changes-without-findings',
        );
        expect(d(untrusted((s) => void (s.retirements = [])))).toEqual({
            kind: 'notify',
            reason: 'untrusted-task-link',
            findings: [{ runId: 'r1', id: 'f1' }],
        });
        // Gates after the link check are not consulted on this path.
        const later: Array<(s: PrSnapshot) => void> = [
            (s) => void (s.deps.state = 'unmet'),
            (s) => void (s.deps.pipelineUmbrella = true),
            (s) => void (s.effectsApproval = null),
            (s) => void (s.ci = null),
            (s) => void (s.conflicts = null),
            (s) => {
                s.retirements = [];
                s.blockingNotifiedAt = NOW - 100 * HOUR;
            },
        ];
        for (const f of later) expectReason(d(untrusted(f)), 'notify', 'untrusted-task-link');
    });

    test('protected paths escalate on an untrusted link too, before any triage or review', () => {
        for (const brk of [
            (s: PrSnapshot) => void (s.link.taskOpen = false),
            (s: PrSnapshot) => void (s.link.claimantRegisteredBranch = false),
        ]) {
            const s = mut((x) => {
                brk(x);
                x.touches.protectedPaths = true;
                x.triage = null;
                x.reviews = [];
            });
            for (const mode of ['review-only', 'dry-run', 'live'] as const) {
                expect(d(s, policy(mode))).toEqual({ kind: 'escalate', reason: 'touches-protected-paths', to: 'owner' });
            }
        }
    });

    test('dependencies: unmet and unknown both wait', () => {
        expectReason(d(mut((s) => void (s.deps.state = 'unmet'))), 'wait', 'deps-unmet');
        expectReason(d(mut((s) => void (s.deps.state = 'unknown'))), 'wait', 'deps-unknown');
    });

    test('merge effects: anything but an approval bound to this head waits; a denial at head escalates', () => {
        const withApproval = (a: PrSnapshot['effectsApproval']): PrSnapshot => mut((s) => void (s.effectsApproval = a));
        for (const a of [
            null,
            { state: 'pending', boundHead: HEAD },
            { state: 'unverified', boundHead: HEAD },
            { state: 'approved', boundHead: OTHER },
            { state: 'approved', boundHead: HEAD_SAME7 },
            { state: 'approved', boundHead: null },
            { state: 'denied', boundHead: OTHER },
        ] as const) {
            expectReason(d(withApproval(a)), 'wait', 'awaiting-effects-approval');
        }
        expectReason(d(withApproval({ state: 'denied', boundHead: HEAD })), 'escalate', 'effects-approval-denied');
    });

    test('an unapproved effects PR is triaged, reviewed, noted and checked like any other', () => {
        const unapproved = (f: (s: PrSnapshot) => void): PrSnapshot =>
            mut((s) => {
                s.effectsApproval = null;
                f(s);
            });
        expectReason(d(unapproved((s) => void (s.triage = null))), 'run-triage', 'triage-missing');
        expectReason(d(unapproved((s) => void s.reviews.pop())), 'run-reviews', 'review-set-incomplete');
        expectReason(d(unapproved((s) => void (s.retirements = []))), 'notify', 'blocking-findings');
        expectReason(d(unapproved((s) => void (s.ci!.complete = false))), 'wait', 'ci-incomplete');
        expectReason(d(unapproved((s) => void (s.ci!.green = false))), 'notify', 'ci-red');
        expectReason(d(unapproved((s) => void (s.conflicts!.status = 'conflict'))), 'notify', 'merge-conflict');
        expectReason(d(unapproved((s) => void (s.ci!.testedBase = OTHER))), 'wait', 'base-moved');
        // A denial at head is likewise only reached once everything else is clean.
        const denied = (f: (s: PrSnapshot) => void): PrSnapshot =>
            mut((s) => {
                s.effectsApproval = { state: 'denied', boundHead: HEAD };
                f(s);
            });
        expectReason(d(denied((s) => void s.reviews.pop())), 'run-reviews', 'review-set-incomplete');
        expectReason(d(denied((s) => void (s.ci!.green = false))), 'notify', 'ci-red');
        for (const mode of ['dry-run', 'live'] as const) {
            expectReason(d(unapproved(() => {}), policy(mode)), 'wait', 'awaiting-effects-approval');
            expectReason(d(denied(() => {}), policy(mode)), 'escalate', 'effects-approval-denied');
        }
    });

    test('review-only: an otherwise clean effects PR is ready, whatever the approval says', () => {
        for (const a of [null, { state: 'pending', boundHead: HEAD }, { state: 'denied', boundHead: HEAD }] as const) {
            expectReason(d(mut((s) => void (s.effectsApproval = a)), policy('review-only')), 'ready', 'review-only-mode');
        }
    });

    test('approval is not asked for while effects are unclassified or live prerequisites are missing', () => {
        const s = mut((x) => void (x.effectsApproval = null));
        expectReason(d(s, { ...policy('dry-run'), effectsClassified: false }), 'ready', 'effects-unclassified');
        expectReason(d(s, { ...policy('live'), webhookInstalled: false }), 'ready', 'live-prerequisites-missing');
    });

    test('protected paths escalate before triage or any review', () => {
        const s = mut((x) => {
            x.touches.protectedPaths = true;
            x.triage = null;
            x.reviews = [];
        });
        expectReason(d(s), 'escalate', 'touches-protected-paths');
    });

    test('no merge effects touched: no approval is needed', () => {
        const s = mut((x) => {
            x.touches.mergeEffects = false;
            x.effectsApproval = null;
        });
        expect(d(s).kind).toBe('would-merge');
    });

    test('a triage fallback never yields a review set', () => {
        // Complete sets for every pick are on file; a failed triage still derives none.
        const s = mut((x) => {
            x.triage = { ok: false };
            x.reviews.push(run({ runId: 'r4', family: 'luna' }), run({ runId: 'r5', family: 'terra' }));
        });
        expect(d(s)).toEqual({ kind: 'run-triage', reason: 'triage-failed', reservation: 0.1 });
        expect(d(s, policy('live'))).toEqual({ kind: 'run-triage', reason: 'triage-failed', reservation: 0.1 });
    });

    test('an incomplete set names the missing members', () => {
        const primaryOnly = mut((s) => void (s.reviews = [s.reviews[0]!]));
        expect(d(primaryOnly)).toEqual({
            kind: 'run-reviews',
            reason: 'review-set-incomplete',
            pick: 'sol',
            members: [
                { variant: 'vector', family: 'sol', reservation: 1 },
                { variant: 'second', family: 'haiku', reservation: 0.25 },
            ],
        });
        const secondOnly = mut((s) => void (s.reviews = [s.reviews[2]!]));
        expect(d(secondOnly)).toMatchObject({ kind: 'run-reviews', members: [{ variant: 'plain' }, { variant: 'vector' }] });
    });

    test('a member reviewed at a sha sharing the head\'s first 7 characters does not complete the set', () => {
        const s = mut((x) => void (x.reviews[1]!.headSha = HEAD_SAME7));
        expect(d(s)).toMatchObject({ kind: 'run-reviews', members: [{ variant: 'vector', family: 'sol' }] });
    });

    test('budget: a fifth head escalates; a fourth is admitted', () => {
        const heads = (n: number) => (s: PrSnapshot) => {
            s.reviews = [];
            s.attempts = ['1', '2', '3', '4'].slice(0, n).map((x) => ({ headSha: sha(x), reservation: 0.1, loggedCost: 0.1 }));
        };
        expectReason(d(mut(heads(4))), 'escalate', 'review-heads-exhausted');
        expectReason(d(mut(heads(3))), 'run-reviews', 'review-set-incomplete');
    });

    test('budget: the ceiling reached mid-set escalates; an admitted head under it finishes', () => {
        const midSet = (cost: number) => (s: PrSnapshot) => {
            s.reviews = [s.reviews[0]!];
            s.attempts = [
                { headSha: HEAD, reservation: 3, loggedCost: cost },
                { headSha: HEAD, reservation: 1, loggedCost: null }, // failed: stays charged
            ];
        };
        expectReason(d(mut(midSet(4))), 'escalate', 'budget-ceiling-reached');
        expectReason(d(mut(midSet(1))), 'run-reviews', 'review-set-incomplete');
        // An admitted head finishes even when four heads are already admitted.
        const admitted = mut((s) => {
            s.reviews = [s.reviews[0]!];
            s.attempts = ['1', '2', '3'].map((x) => ({ headSha: sha(x), reservation: 0.1, loggedCost: 0.1 }));
            s.attempts.push({ headSha: HEAD, reservation: 1, loggedCost: 0.5 });
        });
        expectReason(d(admitted), 'run-reviews', 'review-set-incomplete');
    });

    test('budget: a run is dispatched only if its planned reservation fits under the ceiling', () => {
        // Missing: vector (reserve 1) then second (reserve 0.25). `spent` is one logged attempt at head.
        const spentAt = (spent: number): Decision =>
            d(
                mut((s) => {
                    s.reviews = [s.reviews[0]!];
                    s.attempts = [{ headSha: HEAD, reservation: 9, loggedCost: spent }];
                }),
            );
        const vector = { variant: 'vector', family: 'sol', reservation: 1 };
        const second = { variant: 'second', family: 'haiku', reservation: 0.25 };
        // 4.99 of 5 with a missing review reserved at 1: not dispatched.
        expect(spentAt(4.99)).toEqual({ kind: 'escalate', reason: 'budget-ceiling-reached', to: 'owner' });
        expect(spentAt(4.01)).toEqual({ kind: 'escalate', reason: 'budget-ceiling-reached', to: 'owner' });
        // Only the first of the two missing members fits: one is dispatched.
        expect(spentAt(4)).toMatchObject({ kind: 'run-reviews', members: [vector] });
        expect((spentAt(4) as { members: unknown[] }).members).toHaveLength(1);
        expect(spentAt(3.76)).toMatchObject({ kind: 'run-reviews', members: [vector] });
        expect((spentAt(3.76) as { members: unknown[] }).members).toHaveLength(1);
        // Both fit, exactly at the ceiling.
        expect(spentAt(3.75)).toEqual({ kind: 'run-reviews', reason: 'review-set-incomplete', pick: 'sol', members: [vector, second] });
        // The prefix is in required order: a later member that would fit alone is not dispatched past one that does not.
        const p = { ...policy(), reservations: { triage: 0.1, plain: 1, second: 0.25, vector: 2 } };
        const s = mut((x) => {
            x.reviews = [x.reviews[0]!];
            x.attempts = [{ headSha: HEAD, reservation: 9, loggedCost: 4 }];
        });
        expect(d(s, p)).toEqual({ kind: 'escalate', reason: 'budget-ceiling-reached', to: 'owner' });
    });

    test('budget: a triage run must fit under the ceiling too', () => {
        const spentAt = (spent: number): Decision =>
            d(
                mut((s) => {
                    s.triage = null;
                    s.attempts = [{ headSha: HEAD, reservation: 9, loggedCost: spent }];
                }),
            );
        expect(spentAt(4.95)).toEqual({ kind: 'escalate', reason: 'budget-ceiling-reached', to: 'owner' });
        expect(spentAt(4.5)).toEqual({ kind: 'run-triage', reason: 'triage-missing', reservation: 0.1 });
    });

    test('a ledger attempt whose reservation is zero, negative, non-finite or missing is an invalid snapshot', () => {
        for (const reservation of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
            for (const loggedCost of [null, 0.5]) {
                const s = mut((x) => void ((x.attempts[0] as unknown) = { headSha: HEAD, reservation, loggedCost }));
                expect(d(s)).toEqual({ kind: 'escalate', reason: 'invalid-snapshot', to: 'owner', field: 'attempts[0].reservation' });
            }
        }
        const missing = mut((x) => void ((x.attempts[0] as unknown) = { headSha: HEAD, loggedCost: null }));
        expect(d(missing)).toMatchObject({ reason: 'invalid-snapshot', field: 'attempts[0].reservation' });
    });

    test('a planned reservation that is zero, negative, non-finite or missing is invalid-policy', () => {
        for (const run of ['triage', 'plain', 'second', 'vector'] as const) {
            for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
                const p = { ...policy(), reservations: { ...policy().reservations, [run]: value } };
                expect(d(clean(), p)).toEqual({ kind: 'escalate', reason: 'invalid-policy', to: 'owner', field: `reservations.${run}` });
            }
        }
        expect(d(clean(), { ...policy(), reservations: undefined })).toMatchObject({ reason: 'invalid-policy', field: 'reservations' });
    });

    test('budget also gates a triage run', () => {
        const s = mut((x) => {
            x.triage = null;
            x.attempts = [{ headSha: HEAD, reservation: 5, loggedCost: null }];
        });
        expectReason(d(s), 'escalate', 'budget-ceiling-reached');
    });

    test('REQUEST CHANGES with an empty blocking list escalates, from any run at head', () => {
        for (const i of [0, 1, 2]) {
            const s = mut((x) => {
                x.reviews[0]!.blocking = [];
                x.retirements = [];
                x.reviews[i]!.verdict = 'REQUEST CHANGES';
            });
            expectReason(d(s), 'escalate', 'request-changes-without-findings');
        }
    });

    test('REQUEST CHANGES at another head does not escalate this one', () => {
        const s = mut((x) => void x.reviews.push(run({ runId: 'old', headSha: OTHER, verdict: 'REQUEST CHANGES' })));
        expect(d(s).kind).toBe('would-merge');
    });

    test('REQUEST CHANGES whose findings are all owner-retired does not block', () => {
        const s = mut((x) => void (x.reviews[0]!.verdict = 'REQUEST CHANGES'));
        expect(d(s).kind).toBe('would-merge');
    });

    test('a later APPROVE does not clear a finding; an owner retirement at head does; one for another head does not', () => {
        const base = (): PrSnapshot =>
            mut((s) => {
                s.retirements = [];
                s.reviews.push(run({ runId: 'r4', verdict: 'APPROVE' }));
            });
        expect(d(base())).toEqual({ kind: 'notify', reason: 'blocking-findings', findings: [{ runId: 'r1', id: 'f1' }] });
        const retired = base();
        retired.retirements = [{ headSha: HEAD, findingId: 'f1' }];
        expect(d(retired).kind).toBe('would-merge');
        const elsewhere = base();
        elsewhere.retirements = [{ headSha: OTHER, findingId: 'f1' }];
        expectReason(d(elsewhere), 'notify', 'blocking-findings');
    });

    test('a finding from a schema-invalid run at head still blocks', () => {
        const s = mut((x) => void x.reviews.push(run({ runId: 'bad', schemaValid: false, verdict: null, blocking: [{ id: 'f9' }] })));
        expect(d(s)).toMatchObject({ kind: 'notify', reason: 'blocking-findings', findings: [{ runId: 'bad', id: 'f9' }] });
    });

    test('stall timers run from the delivered note: 24h → claimant, 72h → owner, exact boundaries', () => {
        const at = (elapsed: number): Decision =>
            d(
                mut((s) => {
                    s.retirements = [];
                    s.blockingNotifiedAt = NOW - elapsed;
                }),
            );
        expect(at(0)).toEqual({ kind: 'wait', reason: 'awaiting-author' });
        expect(at(24 * HOUR - 1)).toEqual({ kind: 'wait', reason: 'awaiting-author' });
        expect(at(24 * HOUR)).toEqual({ kind: 'escalate', reason: 'stalled-claimant', to: 'claimant' });
        expect(at(72 * HOUR - 1)).toEqual({ kind: 'escalate', reason: 'stalled-claimant', to: 'claimant' });
        expect(at(72 * HOUR)).toEqual({ kind: 'escalate', reason: 'stalled-owner', to: 'owner' });
        expect(at(-1)).toMatchObject({ kind: 'escalate', reason: 'invalid-clock', field: 'blockingNotifiedAt' });
    });

    test('the stall thresholds come from policy', () => {
        const s = mut((x) => {
            x.retirements = [];
            x.blockingNotifiedAt = NOW - 2 * HOUR;
        });
        expectReason(d(s, { ...policy(), stallClaimantMs: HOUR, stallOwnerMs: 3 * HOUR }), 'escalate', 'stalled-claimant');
        expectReason(d(s, { ...policy(), stallClaimantMs: HOUR, stallOwnerMs: 2 * HOUR }), 'escalate', 'stalled-owner');
    });

    test('CI: missing, stale head, incomplete wait; red notifies', () => {
        expectReason(d(mut((s) => void (s.ci = null))), 'wait', 'ci-incomplete');
        expectReason(d(mut((s) => void (s.ci!.headSha = OTHER))), 'wait', 'ci-stale-head');
        expectReason(d(mut((s) => void (s.ci!.complete = false))), 'wait', 'ci-incomplete');
        expectReason(d(mut((s) => void (s.ci!.green = false))), 'notify', 'ci-red');
    });

    test('conflicts: every non-clean outcome, and a clean one for another pr, head or base', () => {
        const withDoc = (doc: unknown): PrSnapshot => mut((s) => void ((s as { conflicts: unknown }).conflicts = doc));
        const doc = clean().conflicts!;
        expectReason(d(withDoc({ ...doc, status: 'conflict' })), 'notify', 'merge-conflict');
        expectReason(d(withDoc({ ...doc, status: 'blocked' })), 'notify', 'conflicts-blocked');
        expectReason(d(withDoc({ ...doc, status: 'incomplete' })), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({ ...doc, status: 'error' })), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({ status: 'error', pr: null, headSha: null, baseSha: null })), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc(null)), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({})), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({ ...doc, status: 'CLEAN' })), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({ ...doc, pr: 43 })), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({ ...doc, headSha: HEAD_SAME7 })), 'notify', 'conflicts-unverified');
        expectReason(d(withDoc({ ...doc, baseSha: 'bbbbbbb' })), 'notify', 'conflicts-unverified');
        // A verdict for this PR and head against a base that is no longer the base.
        expectReason(d(withDoc({ ...doc, baseSha: OTHER })), 'wait', 'base-moved');
        expectReason(d(withDoc({ ...doc, status: 'conflict', baseSha: OTHER })), 'wait', 'base-moved');
        expectReason(d(withDoc('clean')), 'escalate', 'invalid-snapshot');
    });

    test('the PR number changing makes the conflicts evidence someone else\'s', () => {
        expectReason(d(mut((s) => void (s.pr.number = 43))), 'notify', 'conflicts-unverified');
    });

    test('base moved since the CI evidence, or CI base unknown: wait', () => {
        expectReason(d(mut((s) => void (s.ci!.testedBase = OTHER))), 'wait', 'base-moved');
        expectReason(d(mut((s) => void (s.ci!.testedBase = null))), 'wait', 'ci-base-unknown');
        expectReason(d(mut((s) => void (s.pr.base = OTHER))), 'wait', 'base-moved');
    });

    test('a new head invalidates every piece of evidence at the old one', () => {
        const s = mut((x) => void (x.pr.head = OTHER));
        expect(d(s)).toMatchObject({ kind: 'run-reviews', members: [{}, {}, {}] });
    });
});

// ── Property: one corrupted field never merges ─────────────────────────────

type Path = Array<string | number>;
const show = (path: Path): string => path.map((k) => (typeof k === 'number' ? `[${k}]` : `.${k}`)).join('');
const DELETE = Symbol('delete');

function walk(node: unknown, path: Path, out: Array<{ path: Path; value: unknown }>): void {
    if (path.length > 0) out.push({ path, value: node });
    if (Array.isArray(node)) node.forEach((child, i) => walk(child, [...path, i], out));
    else if (typeof node === 'object' && node !== null) {
        for (const key of Object.keys(node)) walk((node as Record<string, unknown>)[key], [...path, key], out);
    }
}

function withValue(root: unknown, path: Path, value: unknown): unknown {
    const copy = structuredClone(root);
    let parent = copy as Record<string | number, unknown>;
    for (const key of path.slice(0, -1)) parent = parent[key] as Record<string | number, unknown>;
    const last = path[path.length - 1]!;
    if (value !== DELETE) parent[last] = value;
    else if (Array.isArray(parent)) parent.splice(last as number, 1);
    else delete parent[last];
    return copy;
}

const CLOSED_SET = /\.(kind|state|model|variant|verdict|status|mode)$/;

/**
 * Substitutions that leave a LEGAL value behind, so the snapshot may still
 * merge. They are skipped by name here, never silently. Everything else a
 * field is corrupted with is outside its closed set or malformed.
 */
function exempt(path: string, value: unknown, mode: Mode, route: string): string | null {
    if (route === 'release' && path === '.s.link.claimantRegisteredBranch' && value === true) {
        return 'the creation record already makes the link trusted';
    }
    if (path === '.s.touches.mergeEffects' && value === false) return 'no effects touched: approval not needed';
    if (mode === 'dry-run' && /^\.p\.(mergeGateApplied|webhookInstalled)$/.test(path) && value === false) {
        return 'live prerequisites are not consulted in dry-run';
    }
    // The set is complete, so no paid run is needed and the ledger is not consulted.
    if (path === '.s.attempts' && Array.isArray(value)) return 'empty ledger is legal';
    if (/^\.s\.attempts\[\d+\]$/.test(path) && value === DELETE) return 'shorter ledger is legal';
    if (/^\.s\.attempts\[\d+\]\.headSha$/.test(path) && isFullSha(value)) return 'attempt at another head is legal';
    if (/^\.s\.attempts\[\d+\]\.loggedCost$/.test(path) && (value === null || value === 7)) return 'any cost ≥ 0, or none, is legal';
    // Fewer findings is legal (the retirement then retires nothing).
    if (/^\.s\.reviews\[\d+\]\.blocking$/.test(path) && Array.isArray(value)) return 'no findings is legal';
    if (/^\.s\.reviews\[\d+\]\.blocking\[\d+\]$/.test(path) && value === DELETE) return 'no findings is legal';
    // With no open finding the note timestamp is not consulted.
    if (path === '.s.blockingNotifiedAt' && value === 7) return 'a past timestamp is legal';
    // Opaque text: any non-empty string is legal.
    if (/^\.s\.(repo|triage\.(effort|reason)|reviews\[\d+\]\.runId)$/.test(path) && typeof value === 'string' && value !== '') {
        return 'opaque text';
    }
    return null;
}

function corruptions(path: string, value: unknown): unknown[] {
    const wrongTypes: unknown[] = [DELETE, undefined, null, {}, [], 'x', 7, Number.NaN, true];
    if (typeof value === 'boolean') return [!value, 'true', 'false', 1, 0, DELETE, undefined, null, {}, []];
    if (typeof value === 'number') {
        return [Number.NaN, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, String(value), ...wrongTypes.slice(0, 6), true];
    }
    if (typeof value === 'string' && isFullSha(value)) {
        const same7 = value.slice(0, 7) + (value[7] === 'e' ? 'f' : 'e').repeat(33);
        return [OTHER === value ? sha('9') : OTHER, same7, value.slice(0, 7), value.slice(0, 39), value.toUpperCase(), value + '\n', ' ' + value, '', ...wrongTypes];
    }
    if (typeof value === 'string' && CLOSED_SET.test(path)) {
        return ['garbage', '', 'constructor', '__proto__', 'toString', value.toUpperCase() === value ? value.toLowerCase() : value.toUpperCase(), value + '\n', ' ' + value, ...wrongTypes];
    }
    if (typeof value === 'string') return ['garbage', '', ...wrongTypes];
    return wrongTypes; // null leaves, objects and arrays
}

describe('property: one corrupted, omitted or unknown field never merges', () => {
    const ROUTES = [
        ['change', clean],
        ['release', cleanRelease],
    ] as const;
    for (const mode of ['dry-run', 'live'] as const) {
      for (const [route, make] of ROUTES) {
        test(`${mode}, ${route} PR: every field of the snapshot and the policy`, () => {
            const base = { s: make(), p: policy(mode) };
            expect(merges(d(base.s, base.p))).toBe(true); // the uncorrupted base does merge

            const nodes: Array<{ path: Path; value: unknown }> = [];
            walk(base, [], nodes);
            let tried = 0;
            const skipped: string[] = [];
            const merged: string[] = [];
            for (const { path, value } of nodes) {
                const name = show(path);
                if (name === '.s' || name === '.p') continue; // covered by the whole-argument cases below
                for (const bad of corruptions(name, value)) {
                    if (Object.is(bad, value)) continue;
                    const why = exempt(name, bad, mode, route);
                    if (why !== null) {
                        skipped.push(`${name} ← ${String(bad)} (${why})`);
                        continue;
                    }
                    const c = withValue(base, path, bad) as { s: unknown; p: unknown };
                    tried++;
                    if (merges(d(c.s, c.p))) merged.push(`${name} ← ${typeof bad === 'symbol' ? 'deleted' : JSON.stringify(bad)}`);
                }
            }
            expect(merged).toEqual([]);
            expect(tried).toBeGreaterThan(route === 'change' ? 900 : 750);
            // The exemption list is exactly the legal substitutions, no more.
            expect(skipped.length).toBeLessThan(30);
        });
      }

        test(`${mode}: a missing or non-object snapshot, policy or clock`, () => {
            for (const bad of [undefined, null, 'x', 7, [], {}, Number.NaN]) {
                expect(merges(d(bad, policy(mode)))).toBe(false);
                expect(merges(d(clean(), bad))).toBe(false);
            }
            for (const bad of [undefined, null, 'x', Number.NaN, -1, Number.POSITIVE_INFINITY, {}, []]) {
                expect(merges(d(clean(), policy(mode), bad))).toBe(false);
            }
        });
    }

    test('a corrupted reservation never dispatches a paid run either', () => {
        const needsTriage = (): PrSnapshot => {
            const s = clean();
            s.triage = null;
            return s;
        };
        const needsReviews = (): PrSnapshot => {
            const s = clean();
            s.reviews = [];
            return s;
        };
        const dispatches = (decision: Decision): boolean => decision.kind === 'run-triage' || decision.kind === 'run-reviews';
        const bad: unknown[] = [0, -1, -0.1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1', null, undefined, DELETE, {}, [], true];
        let tried = 0;
        for (const make of [needsTriage, needsReviews]) {
            expect(dispatches(d(make()))).toBe(true); // uncorrupted, it does dispatch
            for (const mode of ['review-only', 'dry-run', 'live'] as const) {
                for (const value of bad) {
                    for (const path of [['p', 'reservations'], ...['triage', 'plain', 'second', 'vector'].map((k) => ['p', 'reservations', k])]) {
                        const c = withValue({ s: make(), p: policy(mode) }, path, value) as { s: unknown; p: unknown };
                        const decision = d(c.s, c.p);
                        tried++;
                        expect(dispatches(decision) || merges(decision)).toBe(false);
                        expect(decision.reason).toBe('invalid-policy');
                    }
                    for (const key of ['reservation']) {
                        const c = withValue({ s: make(), p: policy(mode) }, ['s', 'attempts', 0, key], value) as { s: unknown; p: unknown };
                        const decision = d(c.s, c.p);
                        tried++;
                        expect(dispatches(decision) || merges(decision)).toBe(false);
                        expect(decision.reason).toBe('invalid-snapshot');
                    }
                }
            }
        }
        expect(tried).toBe(2 * 3 * bad.length * 6);
    });

    test('every exempted substitution really is legal: it still merges', () => {
        const live = policy('live');
        const cases: Array<(c: { s: PrSnapshot; p: Policy }) => void> = [
            (c) => void (c.s.touches.mergeEffects = false),
            (c) => void (c.s.attempts = []),
            (c) => void c.s.attempts.pop(),
            (c) => void (c.s.attempts[0]!.headSha = OTHER),
            (c) => void (c.s.attempts[0]!.loggedCost = null),
            (c) => void (c.s.attempts[1]!.loggedCost = 7),
            (c) => void (c.s.reviews[0]!.blocking = []),
            (c) => void (c.s.blockingNotifiedAt = 7),
            (c) => void (c.s.repo = 'garbage'),
            (c) => void (c.s.reviews[0]!.runId = 'garbage'),
            (c) => void ((c.s.triage as { effort: string }).effort = 'garbage'),
            (c) => void ((c.s.triage as { reason: string }).reason = 'garbage'),
            (c) => void c.s.reviews[0]!.blocking.pop(),
        ];
        for (const f of cases) {
            const c = { s: clean(), p: { ...live } };
            f(c);
            expect(d(c.s, c.p).kind).toBe('merge');
        }
        expect(d(clean(), { ...policy('dry-run'), mergeGateApplied: false, webhookInstalled: false }).kind).toBe('would-merge');
        const release = cleanRelease();
        expect(d(release, live).kind).toBe('merge');
        release.link.claimantRegisteredBranch = true;
        expect(d(release, live).kind).toBe('merge');
    });
});

// ── Coverage of the closed reason set ──────────────────────────────────────

describe('reason codes', () => {
    // Runs last in this file: every test above records the reasons it produced.
    test('every code in the closed set is produced by a test above, and nothing outside it', () => {
        const all = Object.entries(REASONS).flatMap(([kind, reasons]) => reasons.map((r) => `${kind}/${r}`));
        expect(all.filter((r) => !seen.has(r))).toEqual([]);
        expect([...seen].filter((r) => !all.includes(r))).toEqual([]);
    });
});
