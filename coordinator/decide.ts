/**
 * PR coordinator — the pure decision core (slice 1 of 4).
 *
 * `decide(snapshot, policy, now)` maps the evidence for ONE pull request to one
 * `Decision`. No I/O of any kind happens here: no files, network, git, clock or
 * environment. `coordinator/tsconfig.json` compiles this with `types: []`; run
 * `npx tsc -p coordinator` (CI does), since Bun does not type-check.
 *
 * Fail closed: a gate passes only on an exact positive match. Anything missing,
 * malformed or outside a closed set takes the non-merging branch.
 */

import {
    APPROVAL_STATES,
    CONFLICT_STATUSES,
    DEP_STATES,
    MODES,
    PR_KINDS,
    TRIAGE_MODELS,
    VARIANTS,
    VERDICTS,
} from './types';
import type {
    BudgetState,
    ConflictsResult,
    Decision,
    DispatchedMember,
    Member,
    Mode,
    OpenFinding,
    OwnerApproval,
    Policy,
    PrSnapshot,
    ReasonOf,
    Reservations,
    Retirement,
    ReviewPick,
    ReviewRun,
    ReviewSetState,
    Variant,
} from './types';

// ── Primitive checks ───────────────────────────────────────────────────────

const FULL_SHA = /^[0-9a-f]{40}$/;

/** A full 40-char lowercase hex sha. Abbreviations and uppercase are refused. */
export function isFullSha(value: unknown): value is string {
    return typeof value === 'string' && FULL_SHA.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends readonly string[]>(set: T, value: unknown): value is T[number] {
    return typeof value === 'string' && set.includes(value);
}

function isText(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isBool(value: unknown): value is boolean {
    return value === true || value === false;
}

/** A finite number ≥ 0 (costs, timestamps, durations). NaN and Infinity are refused. */
function isAmount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** A finite number > 0 (reservations). */
function isPositive(value: unknown): value is number {
    return isAmount(value) && value > 0;
}

// ── Exported helpers ───────────────────────────────────────────────────────

/**
 * The mode of `repo` in a `{repo: mode}` map. A repo that is missing, or whose
 * value is not a known mode, is `review-only`.
 */
export function resolveMode(modes: unknown, repo: string): Mode {
    if (!isRecord(modes) || !Object.prototype.hasOwnProperty.call(modes, repo)) return 'review-only';
    const mode = modes[repo];
    return isOneOf(MODES, mode) ? mode : 'review-only';
}

/**
 * The review-set members a pick requires. `secondFamily` is the model family
 * that runs the `second` variant. An unknown pick or an empty `secondFamily`
 * returns `[]`, which `reviewSetState` never treats as complete.
 */
export function requiredMembers(pick: ReviewPick, secondFamily: string): Member[] {
    if (!isText(secondFamily)) return [];
    const second: Member = { variant: 'second', family: secondFamily };
    switch (pick) {
        case 'luna':
            return [{ variant: 'plain', family: 'luna' }];
        case 'terra':
            return [{ variant: 'plain', family: 'terra' }, second];
        case 'sol':
            return [{ variant: 'plain', family: 'sol' }, { variant: 'vector', family: 'sol' }, second];
        case 'release':
            return [{ variant: 'plain', family: 'terra' }, second];
        default:
            pick satisfies never;
            return [];
    }
}

/** Does this run count as `member` at `head`? Exact full-sha, family and variant match. */
function runCountsAs(run: unknown, member: Member, head: string): boolean {
    return (
        isRecord(run) &&
        isFullSha(head) &&
        run.headSha === head &&
        run.family === member.family &&
        run.variant === member.variant &&
        run.schemaValid === true &&
        isOneOf(VERDICTS, run.verdict) &&
        Array.isArray(run.blocking)
    );
}

/**
 * Which required members of `pick` have a counting run at `head`. `complete` is
 * true only when at least one member is required and none is missing.
 */
export function reviewSetState(
    pick: ReviewPick,
    reviews: readonly ReviewRun[],
    head: string,
    secondFamily: string,
): ReviewSetState {
    const required = requiredMembers(pick, secondFamily);
    const runs: readonly unknown[] = Array.isArray(reviews) ? reviews : [];
    const missing = required.filter((member) => !runs.some((run) => runCountsAs(run, member, head)));
    return { required, missing, complete: required.length > 0 && missing.length === 0 };
}

/**
 * Blocking findings still open at `head`: every finding of every run whose
 * provenance names `head`, minus those an owner record retires at this same
 * head. A later run does not retire an earlier run's finding.
 *
 * Returns `null`, never an empty list, when the question cannot be answered:
 * `head` is not a full sha, a list is not an array, or an entry is malformed.
 * It does not check that finding ids are unique per head (`decide` does): with
 * a shared id, one retirement retires both findings.
 */
export function blockingFindings(
    reviews: readonly ReviewRun[],
    retirements: readonly Retirement[],
    head: string,
): OpenFinding[] | null {
    if (!isFullSha(head) || !Array.isArray(reviews) || !Array.isArray(retirements)) return null;
    const retired = new Set<string>();
    for (const r of retirements as readonly unknown[]) {
        if (!isRecord(r) || !isFullSha(r.headSha) || !isText(r.findingId)) return null;
        if (r.headSha === head) retired.add(r.findingId);
    }
    const open: OpenFinding[] = [];
    for (const run of reviews as readonly unknown[]) {
        if (!isRecord(run) || !isFullSha(run.headSha) || !isText(run.runId) || !Array.isArray(run.blocking)) return null;
        if (run.headSha !== head) continue;
        for (const finding of run.blocking as readonly unknown[]) {
            if (!isRecord(finding) || !isText(finding.id)) return null;
            if (!retired.has(finding.id)) open.push({ runId: run.runId, id: finding.id });
        }
    }
    return open;
}

/**
 * Spend and head admission for one PR. An attempt is charged at its logged cost
 * once it has one, else at its reservation (so failed and unknown outcomes stay
 * charged). A reservation must be > 0. A head is admitted once any attempt
 * names it. `blockedBy` says why no new paid run may start at `head`: a
 * malformed ledger or limit, a new head when `maxHeads` are already admitted,
 * or spend at or over the ceiling. `blockedBy: null` does not mean a given run
 * fits: use `fitsUnderCeiling` with the run's planned reservation.
 */
export function budgetState(
    attempts: readonly unknown[],
    limits: { ceiling: number; maxHeads: number },
    head: string,
): BudgetState {
    const invalid: BudgetState = { valid: false, spent: 0, admittedHeads: [], headAdmitted: false, blockedBy: 'invalid' };
    if (!Array.isArray(attempts) || !isRecord(limits) || !isFullSha(head)) return invalid;
    if (!isAmount(limits.ceiling) || limits.ceiling <= 0) return invalid;
    if (!Number.isSafeInteger(limits.maxHeads) || limits.maxHeads < 1) return invalid;

    let spent = 0;
    const admittedHeads: string[] = [];
    for (const attempt of attempts) {
        if (!isRecord(attempt) || !isFullSha(attempt.headSha) || !isPositive(attempt.reservation)) return invalid;
        if (attempt.loggedCost !== null && !isAmount(attempt.loggedCost)) return invalid;
        spent += attempt.loggedCost === null ? attempt.reservation : attempt.loggedCost;
        if (!admittedHeads.includes(attempt.headSha)) admittedHeads.push(attempt.headSha);
    }
    const headAdmitted = admittedHeads.includes(head);
    let blockedBy: BudgetState['blockedBy'] = null;
    if (!headAdmitted && admittedHeads.length >= limits.maxHeads) blockedBy = 'heads';
    else if (!(spent < limits.ceiling)) blockedBy = 'ceiling';
    return { valid: true, spent, admittedHeads, headAdmitted, blockedBy };
}

/**
 * The planned reservation for one paid run, or null when `reservations` does
 * not hold a finite amount > 0 for it.
 */
export function reservationFor(run: 'triage' | Variant, reservations: Reservations): number | null {
    if (!isRecord(reservations)) return null;
    let amount: unknown;
    switch (run) {
        case 'triage':
            amount = reservations.triage;
            break;
        case 'plain':
            amount = reservations.plain;
            break;
        case 'second':
            amount = reservations.second;
            break;
        case 'vector':
            amount = reservations.vector;
            break;
        default:
            run satisfies never;
            return null;
    }
    return isPositive(amount) ? amount : null;
}

/**
 * How many of `planned` (reservations of the runs to dispatch, in order) fit:
 * the longest prefix with `spent + Σ prefix ≤ ceiling`. 0 when the budget is
 * blocked or malformed, the ceiling is not a positive amount, or the first run
 * does not fit. A planned amount that is not > 0 ends the prefix.
 */
export function fitsUnderCeiling(budget: BudgetState, ceiling: number, planned: readonly number[]): number {
    if (!isRecord(budget) || budget.valid !== true || budget.blockedBy !== null) return 0;
    if (!isAmount(budget.spent) || !isPositive(ceiling) || !Array.isArray(planned)) return 0;
    let total = budget.spent;
    let count = 0;
    for (const amount of planned as readonly unknown[]) {
        if (!isPositive(amount)) break;
        total += amount;
        if (!(total <= ceiling)) break;
        count++;
    }
    return count;
}

/**
 * Is this conflicts document a clean result for exactly this PR, head and base?
 * True only for `status === "clean"` with `pr`, `headSha` and `baseSha` equal to
 * the expected values. A missing or malformed document is not clean. The
 * command's exit code plays no part.
 */
export function conflictsClean(result: unknown, expected: { pr: number; head: string; base: string }): boolean {
    return (
        isRecord(result) &&
        isRecord(expected) &&
        Number.isSafeInteger(expected.pr) &&
        isFullSha(expected.head) &&
        isFullSha(expected.base) &&
        result.status === 'clean' &&
        result.pr === expected.pr &&
        result.headSha === expected.head &&
        result.baseSha === expected.base
    );
}

/** A task link is trusted only for a non-fork PR with an open task whose claimant
 *  registered the branch, or that the coordinator created itself. */
export function taskLinkTrusted(fork: boolean, link: PrSnapshot['link']): boolean {
    return (
        fork === false &&
        isRecord(link) &&
        link.taskOpen === true &&
        (link.claimantRegisteredBranch === true || link.coordinatorCreatedPr === true)
    );
}

// ── Validation (returns the first bad field, or null) ──────────────────────

function validatePrSection(s: unknown): string | null {
    if (!isRecord(s)) return 'snapshot';
    if (!isText(s.repo)) return 'repo';
    const pr = s.pr;
    if (!isRecord(pr)) return 'pr';
    if (!Number.isSafeInteger(pr.number) || (pr.number as number) < 1) return 'pr.number';
    if (!isBool(pr.draft)) return 'pr.draft';
    if (!isBool(pr.fork)) return 'pr.fork';
    if (!isOneOf(PR_KINDS, pr.kind)) return 'pr.kind';
    if (!isFullSha(pr.head)) return 'pr.head';
    if (!isFullSha(pr.base)) return 'pr.base';
    return null;
}

function validateReviews(reviews: unknown): string | null {
    if (!Array.isArray(reviews)) return 'reviews';
    const runIds = new Set<string>();
    const findingKeys = new Set<string>();
    for (let i = 0; i < reviews.length; i++) {
        const run: unknown = reviews[i];
        const at = `reviews[${i}]`;
        if (!isRecord(run)) return at;
        if (!isText(run.runId) || runIds.has(run.runId)) return `${at}.runId`;
        runIds.add(run.runId);
        if (!isFullSha(run.headSha)) return `${at}.headSha`;
        if (!isText(run.family)) return `${at}.family`;
        if (!isOneOf(VARIANTS, run.variant)) return `${at}.variant`;
        if (!isBool(run.schemaValid)) return `${at}.schemaValid`;
        if (run.verdict !== null && !isOneOf(VERDICTS, run.verdict)) return `${at}.verdict`;
        if (run.schemaValid && run.verdict === null) return `${at}.verdict`;
        if (!Array.isArray(run.blocking)) return `${at}.blocking`;
        for (let j = 0; j < run.blocking.length; j++) {
            const finding: unknown = run.blocking[j];
            if (!isRecord(finding) || !isText(finding.id)) return `${at}.blocking[${j}].id`;
            // A retirement names head + finding id, so an id shared by two findings
            // at one head would let one owner record retire both.
            const key = `${run.headSha} ${finding.id}`;
            if (findingKeys.has(key)) return `${at}.blocking[${j}].id`;
            findingKeys.add(key);
        }
    }
    return null;
}

function validateRest(s: PrSnapshot): string | null {
    const raw = s as unknown as Record<string, unknown>;

    const link = raw.link;
    if (!isRecord(link)) return 'link';
    if (!isBool(link.taskOpen)) return 'link.taskOpen';
    if (!isBool(link.claimantRegisteredBranch)) return 'link.claimantRegisteredBranch';
    if (!isBool(link.coordinatorCreatedPr)) return 'link.coordinatorCreatedPr';

    const deps = raw.deps;
    if (!isRecord(deps)) return 'deps';
    if (!isOneOf(DEP_STATES, deps.state)) return 'deps.state';
    if (!isBool(deps.pipelineUmbrella)) return 'deps.pipelineUmbrella';

    const touches = raw.touches;
    if (!isRecord(touches)) return 'touches';
    if (!isFullSha(touches.headSha)) return 'touches.headSha';
    if (!isBool(touches.protectedPaths)) return 'touches.protectedPaths';
    if (!isBool(touches.mergeEffects)) return 'touches.mergeEffects';

    const approval = raw.effectsApproval;
    if (approval !== null) {
        if (!isRecord(approval)) return 'effectsApproval';
        if (!isOneOf(APPROVAL_STATES, approval.state)) return 'effectsApproval.state';
        if (approval.boundHead !== null && !isFullSha(approval.boundHead)) return 'effectsApproval.boundHead';
    }

    const triage = raw.triage;
    if (triage !== null) {
        if (!isRecord(triage)) return 'triage';
        if (!isBool(triage.ok)) return 'triage.ok';
        if (!isFullSha(triage.headSha)) return 'triage.headSha';
        if (triage.ok) {
            if (!isOneOf(TRIAGE_MODELS, triage.model)) return 'triage.model';
            if (!isText(triage.effort)) return 'triage.effort';
            if (!isText(triage.reason)) return 'triage.reason';
        }
    }

    const badReview = validateReviews(raw.reviews);
    if (badReview !== null) return badReview;

    const retirements = raw.retirements;
    if (!Array.isArray(retirements)) return 'retirements';
    for (let i = 0; i < retirements.length; i++) {
        const r: unknown = retirements[i];
        if (!isRecord(r)) return `retirements[${i}]`;
        if (!isFullSha(r.headSha)) return `retirements[${i}].headSha`;
        if (!isText(r.findingId)) return `retirements[${i}].findingId`;
    }

    const attempts = raw.attempts;
    if (!Array.isArray(attempts)) return 'attempts';
    for (let i = 0; i < attempts.length; i++) {
        const a: unknown = attempts[i];
        if (!isRecord(a)) return `attempts[${i}]`;
        if (!isFullSha(a.headSha)) return `attempts[${i}].headSha`;
        if (!isPositive(a.reservation)) return `attempts[${i}].reservation`;
        if (a.loggedCost !== null && !isAmount(a.loggedCost)) return `attempts[${i}].loggedCost`;
    }

    const note = raw.blockingNote;
    if (note !== null) {
        if (!isRecord(note)) return 'blockingNote';
        if (!isFullSha(note.headSha)) return 'blockingNote.headSha';
        if (!isAmount(note.at)) return 'blockingNote.at';
    }

    const ci = raw.ci;
    if (ci !== null) {
        if (!isRecord(ci)) return 'ci';
        if (!isFullSha(ci.headSha)) return 'ci.headSha';
        if (!isBool(ci.complete)) return 'ci.complete';
        if (!isBool(ci.green)) return 'ci.green';
        if (ci.testedBase !== null && !isFullSha(ci.testedBase)) return 'ci.testedBase';
    }

    // The conflicts document's fields are judged where they are used
    // (`conflictsClean`): a malformed document is "not clean", not a bad snapshot.
    if (raw.conflicts !== null && !isRecord(raw.conflicts)) return 'conflicts';

    return null;
}

function validatePolicy(p: unknown): string | null {
    if (!isRecord(p)) return 'policy';
    if (!isOneOf(MODES, p.mode)) return 'mode';
    if (!isAmount(p.ceiling) || p.ceiling <= 0) return 'ceiling';
    if (!Number.isSafeInteger(p.maxHeads) || (p.maxHeads as number) < 1) return 'maxHeads';
    const reservations = p.reservations;
    if (!isRecord(reservations)) return 'reservations';
    for (const run of ['triage', 'plain', 'second', 'vector'] as const) {
        if (!isPositive(reservations[run])) return `reservations.${run}`;
    }
    if (!isText(p.secondFamily)) return 'secondFamily';
    if (!isAmount(p.stallClaimantMs)) return 'stallClaimantMs';
    if (!isAmount(p.stallOwnerMs) || p.stallOwnerMs < p.stallClaimantMs) return 'stallOwnerMs';
    if (!isBool(p.effectsClassified)) return 'effectsClassified';
    if (!isBool(p.mergeGateApplied)) return 'mergeGateApplied';
    if (!isBool(p.webhookInstalled)) return 'webhookInstalled';
    return null;
}

// ── Decision constructors ──────────────────────────────────────────────────

function escalate(reason: ReasonOf<'escalate'>, to: 'owner' | 'claimant' = 'owner', field?: string): Decision {
    return field === undefined ? { kind: 'escalate', reason, to } : { kind: 'escalate', reason, to, field };
}

function wait(reason: ReasonOf<'wait'>): Decision {
    return { kind: 'wait', reason };
}

function notify(reason: ReasonOf<'notify'>, findings: OpenFinding[] = []): Decision {
    return { kind: 'notify', reason, findings };
}

// ── Gates ──────────────────────────────────────────────────────────────────

/** null = a new paid run may start; otherwise the escalation that stops it. */
function admission(budget: BudgetState): Decision | null {
    switch (budget.blockedBy) {
        case null:
            return null;
        case 'heads':
            return escalate('review-heads-exhausted');
        case 'ceiling':
            return escalate('budget-ceiling-reached');
        case 'invalid':
            return escalate('invalid-snapshot', 'owner', 'attempts');
        default:
            budget.blockedBy satisfies never;
            return escalate('invalid-snapshot', 'owner', 'attempts');
    }
}

/** `run-triage` if the head is admitted and the triage reservation fits; else the escalation. */
function dispatchTriage(budget: BudgetState, policy: Policy, reason: ReasonOf<'run-triage'>): Decision {
    const blocked = admission(budget);
    if (blocked !== null) return blocked;
    const reservation = reservationFor('triage', policy.reservations);
    if (reservation === null) return escalate('invalid-policy', 'owner', 'reservations.triage');
    if (fitsUnderCeiling(budget, policy.ceiling, [reservation]) !== 1) return escalate('budget-ceiling-reached');
    return { kind: 'run-triage', reason, reservation };
}

/**
 * `run-reviews` for the longest prefix of the missing members (in required
 * order) whose reservations fit under the ceiling; an escalation when the head
 * is not admitted or not even the first member fits.
 */
function dispatchReviews(budget: BudgetState, policy: Policy, pick: ReviewPick, missing: Member[]): Decision {
    const blocked = admission(budget);
    if (blocked !== null) return blocked;
    const planned: DispatchedMember[] = [];
    for (const member of missing) {
        const reservation = reservationFor(member.variant, policy.reservations);
        if (reservation === null) return escalate('invalid-policy', 'owner', `reservations.${member.variant}`);
        planned.push({ ...member, reservation });
    }
    const fit = fitsUnderCeiling(
        budget,
        policy.ceiling,
        planned.map((m) => m.reservation),
    );
    // An incomplete set with nothing missing (no valid pick) dispatches nothing either.
    if (fit < 1) return escalate('budget-ceiling-reached');
    return { kind: 'run-reviews', reason: 'review-set-incomplete', pick, members: planned.slice(0, fit) };
}

/** null = approved at this head; otherwise the non-merging decision. */
function effectsApprovalGate(approval: OwnerApproval | null, head: string): Decision | null {
    if (approval === null) return wait('awaiting-effects-approval');
    switch (approval.state) {
        case 'approved':
            return approval.boundHead === head ? null : wait('awaiting-effects-approval');
        case 'denied':
            // A denial bound to another head says nothing about this one.
            return approval.boundHead === head
                ? escalate('effects-approval-denied')
                : wait('awaiting-effects-approval');
        case 'pending':
        case 'unverified':
            return wait('awaiting-effects-approval');
        default:
            approval.state satisfies never;
            return wait('awaiting-effects-approval');
    }
}

/**
 * The review stage, shared by the trusted and the untrusted-link paths: pick,
 * review set (running what is missing, within budget), self-contradicting
 * runs, then the open blocking findings.
 */
function reviewStage(s: PrSnapshot, policy: Policy): { decision: Decision } | { open: OpenFinding[] } {
    const head = s.pr.head;
    const budget = budgetState(s.attempts, policy, head);

    let pick: ReviewPick;
    switch (s.pr.kind) {
        case 'release':
            pick = 'release';
            break;
        case 'change': {
            // A failed triage is never a pick: no review set is derived from it.
            // A triage run at another head says nothing about this one.
            if (s.triage === null || s.triage.headSha !== head) {
                return { decision: dispatchTriage(budget, policy, 'triage-missing') };
            }
            if (s.triage.ok !== true) return { decision: dispatchTriage(budget, policy, 'triage-failed') };
            pick = s.triage.model;
            break;
        }
        default:
            s.pr.kind satisfies never;
            return { decision: escalate('invalid-snapshot', 'owner', 'pr.kind') };
    }

    const set = reviewSetState(pick, s.reviews, head, policy.secondFamily);
    if (set.complete !== true) return { decision: dispatchReviews(budget, policy, pick, set.missing) };

    const atHead = s.reviews.filter((run) => run.headSha === head);
    if (atHead.some((run) => run.variant === 'second' && run.verdict === 'APPROVE')) {
        return { decision: escalate('second-approved') };
    }
    if (atHead.some((run) => run.verdict === 'REQUEST CHANGES' && run.blocking.length === 0)) {
        return { decision: escalate('request-changes-without-findings') };
    }
    const open = blockingFindings(s.reviews, s.retirements, head);
    if (open === null) return { decision: escalate('invalid-snapshot', 'owner', 'reviews') };
    return { open };
}

/** The decision for a conflicts document that `conflictsClean` refused. */
function conflictsFailure(doc: ConflictsResult | null, pr: number, head: string, base: string): Decision {
    if (!isRecord(doc) || !isOneOf(CONFLICT_STATUSES, doc.status)) return notify('conflicts-unverified');
    if (doc.pr !== pr || doc.headSha !== head) return notify('conflicts-unverified');
    if (doc.baseSha !== base) {
        // A verdict for this PR and head, against a base that is no longer the base.
        return isFullSha(doc.baseSha) ? wait('base-moved') : notify('conflicts-unverified');
    }
    switch (doc.status) {
        case 'conflict':
            return notify('merge-conflict');
        case 'blocked':
            return notify('conflicts-blocked');
        case 'clean': // unreachable after conflictsClean; still not a pass here
        case 'incomplete':
        case 'error':
            return notify('conflicts-unverified');
        default:
            doc.status satisfies never;
            return notify('conflicts-unverified');
    }
}

// ── decide ─────────────────────────────────────────────────────────────────

/**
 * Decide what to do with one PR. `now` is epoch milliseconds, passed in.
 * The gates run in a fixed order; the first one that does not pass decides.
 */
export function decide(snapshot: PrSnapshot, policy: Policy, now: number): Decision {
    // 1. Enough of the PR to read draft / fork.
    const badPr = validatePrSection(snapshot);
    if (badPr !== null) return escalate('invalid-snapshot', 'owner', badPr);
    const { pr } = snapshot;
    const { head, base } = pr;

    // 2–3. Drafts are skipped; forks always escalate.
    if (pr.draft !== false) return { kind: 'skip', reason: 'draft' };
    if (pr.fork !== false) return escalate('fork');

    // 4. Everything else must be well-formed before any gate reads it.
    const badField = validateRest(snapshot);
    if (badField !== null) return escalate('invalid-snapshot', 'owner', badField);
    const badPolicy = validatePolicy(policy);
    if (badPolicy !== null) return escalate('invalid-policy', 'owner', badPolicy);
    if (!isAmount(now)) return escalate('invalid-clock', 'owner', 'now');

    // 5. Self-authored PRs: only a release PR the coordinator created is handled.
    const selfAuthored = snapshot.link.coordinatorCreatedPr;
    if (pr.kind === 'release' && selfAuthored !== true) return escalate('release-not-coordinator-created');
    if (pr.kind !== 'release' && selfAuthored !== false) return escalate('self-authored-unsupported');

    // 6. Trusted roots, the gate, the coordinator, its config: escalate before
    // the link check, so before any triage or review, whatever the link says.
    // What the diff touches is only known for the head it was computed at.
    if (snapshot.touches.headSha !== head) return wait('touches-stale-head');
    if (snapshot.touches.protectedPaths !== false) return escalate('touches-protected-paths');

    // 7. No trusted task link: review and notify, never merge.
    if (taskLinkTrusted(pr.fork, snapshot.link) !== true) {
        const reviewed = reviewStage(snapshot, policy);
        if ('decision' in reviewed) return reviewed.decision;
        return notify('untrusted-task-link', reviewed.open);
    }

    // 8. Dependencies and umbrellas.
    switch (snapshot.deps.state) {
        case 'met':
            break;
        case 'unmet':
            return wait('deps-unmet');
        case 'unknown':
            return wait('deps-unknown');
        default:
            snapshot.deps.state satisfies never;
            return wait('deps-unknown');
    }
    if (snapshot.deps.pipelineUmbrella !== false) return wait('pipeline-umbrella');

    // 9–11. Triage, review set, self-contradicting runs.
    const reviewed = reviewStage(snapshot, policy);
    if ('decision' in reviewed) return reviewed.decision;

    // 12. Blocking findings, and the stall timers once the note is delivered.
    if (reviewed.open.length !== 0) {
        // A note delivered for another head told the author nothing about these findings.
        const note = snapshot.blockingNote;
        if (note === null || note.headSha !== head) return notify('blocking-findings', reviewed.open);
        const elapsed = now - note.at;
        if (!(elapsed >= 0)) return escalate('invalid-clock', 'owner', 'blockingNote.at');
        if (elapsed >= policy.stallOwnerMs) return escalate('stalled-owner', 'owner');
        if (elapsed >= policy.stallClaimantMs) return escalate('stalled-claimant', 'claimant');
        return wait('awaiting-author');
    }

    // 13. CI for this head.
    const ci = snapshot.ci;
    if (ci === null) return wait('ci-incomplete');
    if (ci.headSha !== head) return wait('ci-stale-head');
    if (ci.complete !== true) return wait('ci-incomplete');
    if (ci.green !== true) return notify('ci-red');

    // 14. A real merge check: clean, for this PR, head and base.
    if (conflictsClean(snapshot.conflicts, { pr: pr.number, head, base }) !== true) {
        return conflictsFailure(snapshot.conflicts, pr.number, head, base);
    }

    // 15. CI must have tested against the base as it is now.
    if (ci.testedBase === null) return wait('ci-base-unknown');
    if (ci.testedBase !== base) return wait('base-moved');

    // 16. Every evidence gate passed. Mode decides, here and nowhere else. A
    // merge that triggers effects also needs the owner's approval bound to this
    // head; it is asked for last, with the evidence in hand, and never in
    // review-only, where nothing merges.
    const target = { repo: snapshot.repo, pr: pr.number, head, base };
    const effectsBlocked =
        snapshot.touches.mergeEffects !== false ? effectsApprovalGate(snapshot.effectsApproval, head) : null;
    switch (policy.mode) {
        case 'review-only':
            return { kind: 'ready', reason: 'review-only-mode', ...target };
        case 'dry-run':
            if (policy.effectsClassified !== true) return { kind: 'ready', reason: 'effects-unclassified', ...target };
            if (effectsBlocked !== null) return effectsBlocked;
            return { kind: 'would-merge', reason: 'clean-dry-run', ...target };
        case 'live':
            if (policy.effectsClassified !== true) return { kind: 'ready', reason: 'effects-unclassified', ...target };
            if (policy.mergeGateApplied !== true || policy.webhookInstalled !== true) {
                return { kind: 'ready', reason: 'live-prerequisites-missing', ...target };
            }
            if (effectsBlocked !== null) return effectsBlocked;
            return { kind: 'merge', reason: 'clean-live', ...target };
        default:
            policy.mode satisfies never;
            return { kind: 'ready', reason: 'review-only-mode', ...target };
    }
}
