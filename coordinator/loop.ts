/// <reference types="node" />
/**
 * PR coordinator — the PR loop (slice 4 of 4, part 3b).
 *
 * One pass: for every open PR of every configured repo, build a `PrSnapshot`,
 * ask `decide`, and do the one thing it says. After a paid step (triage, a
 * review set) the PR is read again from scratch and decided again, so nothing
 * is done on a decision made before the run. A PR gets at most one triage and
 * one review dispatch per pass.
 *
 * Fail closed: a PR whose evidence cannot be read whole gets no snapshot and
 * nothing is done for it this pass. A null from `classifyTouches` or
 * `parseTriage` is never replaced by a default.
 *
 * What a snapshot does not hold yet, and why that is safe:
 *   - `link.claimantRegisteredBranch` and `coordinatorCreatedPr` are false:
 *     invoak cannot say who registered a branch (invk-fosip). So no PR has a
 *     trusted task link, and `decide` reviews and notifies, never merges.
 *   - ponytail: `deps` is unknown and `ci`, `conflicts`, `retirements` and
 *     `effectsApproval` are empty. `decide` reads them only past the link
 *     check. Fill them in the change that makes a link trusted.
 *   - ponytail: every PR is a `change`. A release PR is reviewed like one.
 *
 * The note names runs and finding ids, never review text: a review quotes the
 * PR it read, and that text must not reach another agent through its task.
 */

import { join } from 'node:path';
import type { LoopConfig, RepoConfig } from './config';
import { decide } from './decide';
import type { GitHub, InventoryPr } from './github';
import type { Invoak } from './invoak';
import { classifyTouches, parseTriage, readReviewFiles } from './readers';
import type { CommandRunner, ReviewFile } from './readers';
import type { Actions, DeliveryResult } from './reconcile';
import type { State } from './state';
import type { Decision, DispatchedMember, PrSnapshot, Variant } from './types';

export interface Io {
    /** prsan's review files whose name starts with `prefix`, and how many such names the directory lists. */
    reviewFiles(prefix: string): { files: ReviewFile[]; expectedCount: number };
    /** Writes `text` to a new private file, runs `use` on its path, then removes it. */
    withDiffFile<T>(text: string, use: (path: string) => Promise<T>): Promise<T>;
}

export interface World {
    github: Pick<GitHub, 'inventory' | 'readPr' | 'detail' | 'files' | 'diff'>;
    tasks: Pick<Invoak, 'task'>;
    run: CommandRunner;
    io: Io;
    state: Pick<State, 'reserve' | 'saveTriage' | 'triageFor' | 'attemptsFor' | 'blockingNoteFor'>;
    actions: Pick<Actions, 'note' | 'escalate'>;
    /** Epoch milliseconds. */
    now: () => number;
}

export interface PrReport {
    repo: string;
    pr: number;
    head: string;
    /** The last decision, as `kind:reason`; `none` when there was no snapshot. */
    decision: string;
    /** What was done, in order. */
    did: string[];
}

/** Reviewer runs never notify or stage: delivery is the coordinator's. Isolation is not optional. */
const PRSAN_ENV = { PRSAN_ISOLATION: 'require', PRSAN_PINNED: '1', PRSAN_NO_FOLLOWUP: '1' } as const;

const VARIANT_FLAG: Record<Variant, readonly string[]> = { plain: [], second: ['--second'], vector: ['--vector'] };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const filePrefix = (repo: string, pr: number): string => `${repo.replace(/\//g, '_')}-${pr}-`;

// ── Snapshot ───────────────────────────────────────────────────────────────

/** Everything `decide` needs about one listed PR, or null when it cannot be read whole at the listed head. */
export async function buildSnapshot(
    world: World,
    config: LoopConfig,
    repo: string,
    listed: InventoryPr,
): Promise<PrSnapshot | null> {
    const repoConfig = config.repos[repo];
    if (repoConfig === undefined) return null;
    const ref = { repo, pr: listed.number };
    const pr = await world.github.readPr(ref);
    if (pr.kind !== 'open' || pr.head !== listed.head) return null;
    const changed = await world.github.files(ref);
    const touches = changed === null ? null : classifyTouches(changed, repoConfig.touches);
    if (touches === null) return null;
    const head = pr.head;

    const listing = world.io.reviewFiles(filePrefix(repo, listed.number));
    const context = { repo, pr: listed.number, head, families: config.prsan.families };
    const reviews = readReviewFiles(listing.files, context, listing.expectedCount).runs;
    const printed = world.state.triageFor(repo, listed.number, head);

    return {
        repo,
        pr: { number: listed.number, draft: listed.draft, fork: listed.fork, kind: 'change', head, base: pr.base },
        link: {
            taskOpen: (await noteTarget(world, repoConfig, listed.title)) !== null,
            claimantRegisteredBranch: false,
            coordinatorCreatedPr: false,
        },
        deps: { state: 'unknown', pipelineUmbrella: false },
        touches,
        effectsApproval: null,
        triage: printed === null ? null : parseTriage(printed, head),
        reviews,
        retirements: [],
        attempts: world.state.attemptsFor(repo, listed.number),
        blockingNote: world.state.blockingNoteFor(repo, listed.number),
        ci: null,
        conflicts: null,
    };
}

export interface NoteTarget {
    taskId: string;
    claimant: string | null;
}

const TITLE_TASK = /\(([a-z0-9]{2,12})-[a-z0-9]+\)/g;

/**
 * The task a note about this PR goes to. The title is the author's, so it
 * names a target only when it holds exactly one `(xx-abcd)`, in a project this
 * repo's config lists, and invoak says that task is being worked on.
 */
export async function noteTarget(
    world: Pick<World, 'tasks'>,
    repoConfig: RepoConfig,
    title: string,
): Promise<NoteTarget | null> {
    const named = [...title.matchAll(TITLE_TASK)];
    const only = named.length === 1 ? named[0] : undefined;
    if (only === undefined || only[1] === undefined || !repoConfig.taskProjects.includes(only[1])) return null;
    const taskId = only[0].slice(1, -1);
    const task = await world.tasks.task(taskId);
    return task !== null && task.status === 'in_progress' ? { taskId, claimant: task.claimedBy } : null;
}

// ── Paid runs ──────────────────────────────────────────────────────────────

/**
 * Can a reviewer run start at all? Null, or why not. Asked once per pass,
 * before the first reservation: a triage that never reached a model prints
 * the same line as one whose model failed, and a prsan with no pin exits
 * before it reviews, so without this a set-up fault is charged as a run on
 * every PR, every wake, up to the ceiling. All three probes run through the
 * same runner and environment as the runs themselves, and call no model.
 */
export async function reviewerFault(world: Pick<World, 'run'>, config: LoopConfig): Promise<string | null> {
    const { home } = config.prsan;
    const probe = async (command: string, argv: string[]): Promise<string | null> => {
        try {
            const result: unknown = await world.run(command, argv, { cwd: home, env: PRSAN_ENV });
            return isRecord(result) && result.exitCode === 0 && typeof result.stdout === 'string'
                ? result.stdout
                : null;
        } catch {
            return null;
        }
    };
    if ((await probe(join(home, 'bin', 'isolated-run'), ['--check']))?.trim() !== 'sandbox-exec') {
        return 'no reviewer sandbox on this host';
    }
    if (((await probe(join(home, 'bin', 'trusted-inputs'), [])) ?? '').trim() === '') {
        return 'no usable prsan pin (bin/trusted-inputs)';
    }
    if ((await probe('/bin/sh', ['-c', '[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ]'])) === null) {
        return 'CLAUDE_CODE_OAUTH_TOKEN is not set for reviewer runs';
    }
    return null;
}

interface PassBudget {
    reviewsLeft: number;
    /** `reviewerFault`, once it has been asked. */
    fault?: string | null;
}

/** Runs triage at the snapshot's head and keeps its pick. Budget is reserved before the run and stays charged. */
async function runTriage(world: World, config: LoopConfig, s: PrSnapshot, reservation: number): Promise<string> {
    const ref = { repo: s.repo, pr: s.pr.number };
    const head = s.pr.head;
    const diff = await world.github.diff(ref);
    if (diff === undefined) return 'triage: no diff, not run';
    // Read after the diff: a head that is still the snapshot's means the diff is that head's.
    const after = await world.github.detail(ref);
    if (after.kind !== 'open' || after.head !== head) return 'triage: head moved, not run';
    const { home, timeoutMs } = config.prsan;
    return world.io.withDiffFile(diff, async (path) => {
        world.state.reserve({ ...ref, head, run: 'triage', reservation }, world.now());
        let result: unknown;
        try {
            result = await world.run(join(home, 'bin', 'triage'), [path], { cwd: home, env: PRSAN_ENV, timeoutMs });
        } catch {
            return 'triage: run failed';
        }
        const printed = isRecord(result) && result.exitCode === 0 ? result.stdout : undefined;
        // Only a pick is kept. A kept failure would stand for this head for good.
        if (typeof printed !== 'string' || parseTriage(printed, head)?.ok !== true) return 'triage: no pick';
        world.state.saveTriage({ ...ref, head }, printed, world.now());
        return 'triage: picked';
    });
}

/**
 * Runs the dispatched members, at most `allowed` of them. Returns what was
 * done and how many runs were started.
 * ponytail: a run stays charged at its reservation. prsan prints its cost on
 * stderr and in review-log.md, neither keyed by run id; log real costs when
 * prsan writes one per run.
 */
async function runReviews(
    world: World,
    config: LoopConfig,
    s: PrSnapshot,
    members: readonly DispatchedMember[],
    allowed: number,
): Promise<{ did: string[]; started: number }> {
    const did: string[] = [];
    let started = 0;
    const effort = s.triage !== null && s.triage.ok ? s.triage.effort : null;
    if (effort === null) return { did: ['reviews: no triage effort, not run'], started };
    const { home, timeoutMs, models } = config.prsan;
    for (const member of members) {
        const name = `${member.family}/${member.variant}`;
        if (started >= allowed) {
            did.push(`review ${name}: pass cap reached, not run`);
            continue;
        }
        const model = Object.hasOwn(models, member.family) ? models[member.family] : undefined;
        if (model === undefined) {
            did.push(`review ${name}: no model for this family, not run`);
            continue;
        }
        // prsan is given a PR number and reviews whatever head it finds. The head that passed the
        // protected-path check is asked for again right before each run, so a push stops the set.
        // ponytail: this narrows the gap, it does not close it. Closing it needs prsan to take
        // the expected head and refuse another (envk-brepa's --expect-head, for reviews).
        const at = await world.github.detail({ repo: s.repo, pr: s.pr.number });
        if (at.kind !== 'open' || at.head !== s.pr.head) {
            did.push(`review ${name}: head moved, not run`);
            break;
        }
        started += 1;
        world.state.reserve(
            { repo: s.repo, pr: s.pr.number, head: s.pr.head, run: member.variant, reservation: member.reservation },
            world.now(),
        );
        const argv = ['-m', model, '-e', effort, ...VARIANT_FLAG[member.variant], `${s.repo}#${s.pr.number}`];
        let exit: unknown;
        try {
            const result: unknown = await world.run(join(home, 'bin', 'prsan'), argv, {
                cwd: home,
                env: PRSAN_ENV,
                timeoutMs,
            });
            exit = isRecord(result) ? result.exitCode : undefined;
        } catch {
            exit = undefined;
        }
        did.push(`review ${name}: ${typeof exit === 'number' ? `exit ${exit}` : 'no exit code'}`);
    }
    return { did, started };
}

// ── Notes and escalations ──────────────────────────────────────────────────

function noteBody(config: LoopConfig, s: PrSnapshot, d: Extract<Decision, { kind: 'notify' }>): string {
    const head = s.pr.head;
    const runs = s.reviews
        .filter((run) => run.headSha === head)
        .map(
            (run) =>
                `  ${run.runId} ${run.family}/${run.variant}: ${run.verdict ?? 'unreadable'}, ${run.blocking.length} blocking`,
        );
    const open = d.findings.map((finding) => `  ${finding.id}`);
    return [
        `Coordinator: ${s.repo}#${s.pr.number} at ${head}: ${d.reason}`,
        d.reason === 'untrusted-task-link'
            ? 'Reviewed, not merged: nothing proves this task and this PR belong together yet.'
            : 'Not merged.',
        'Review runs at this head:',
        ...(runs.length === 0 ? ['  none'] : runs),
        'Open blocking findings (<run id>:<n>, the nth entry under "Blocking defects"):',
        ...(open.length === 0 ? ['  none'] : open),
        `Review files: ${join(config.prsan.home, 'reviews', `${filePrefix(s.repo, s.pr.number)}${head.slice(0, 7)}-*.md`)}`,
    ].join('\n');
}

function escalationBody(s: PrSnapshot, reason: string, field?: string): string {
    const spent = s.attempts.reduce((sum, a) => sum + (a.loggedCost ?? a.reservation), 0);
    return [
        `Coordinator: ${s.repo}#${s.pr.number} at ${s.pr.head} needs a decision.`,
        `reason: ${reason}${field === undefined ? '' : ` (${field})`}`,
        `charged so far: ${spent.toFixed(2)}`,
    ].join('\n');
}

const delivery = (what: string, result: DeliveryResult): string => `${what}: ${result.kind}`;

// ── The pass ───────────────────────────────────────────────────────────────

async function handle(
    world: World,
    config: LoopConfig,
    repo: string,
    repoConfig: RepoConfig,
    listed: InventoryPr,
    budget: PassBudget,
): Promise<PrReport> {
    const report: PrReport = { repo, pr: listed.number, head: listed.head, decision: 'none', did: [] };
    const paid = new Set<Decision['kind']>();
    for (;;) {
        const s = await buildSnapshot(world, config, repo, listed);
        if (s === null) {
            report.decision = 'none';
            report.did.push('no snapshot: the PR could not be read whole at the listed head');
            return report;
        }
        const d = decide(s, repoConfig.policy, world.now());
        report.decision = `${d.kind}:${d.reason}`;
        const spec = { repo, pr: s.pr.number, head: s.pr.head };
        if (d.kind === 'run-triage' || d.kind === 'run-reviews') {
            if (paid.has(d.kind)) return report;
            budget.fault ??= await reviewerFault(world, config);
            if (budget.fault !== null) {
                report.did.push(`nothing run, nothing charged: ${budget.fault}`);
                return report;
            }
        }
        switch (d.kind) {
            case 'run-triage':
                paid.add(d.kind);
                report.did.push(await runTriage(world, config, s, d.reservation));
                continue;
            case 'run-reviews': {
                paid.add(d.kind);
                const ran = await runReviews(world, config, s, d.members, budget.reviewsLeft);
                budget.reviewsLeft -= ran.started;
                report.did.push(...ran.did);
                if (ran.started === 0) return report;
                continue;
            }
            case 'notify': {
                const target = await noteTarget(world, repoConfig, listed.title);
                const sent =
                    target === null
                        ? await world.actions.escalate(
                              {
                                  ...spec,
                                  reason: 'no-note-target',
                                  to: config.owner,
                                  body: escalationBody(s, d.reason),
                              },
                              world.now(),
                          )
                        : await world.actions.note(
                              { ...spec, reason: d.reason, taskId: target.taskId, body: noteBody(config, s, d) },
                              world.now(),
                          );
                report.did.push(delivery(target === null ? 'escalation (no note target)' : 'note', sent));
                return report;
            }
            case 'escalate': {
                // To the claimant only when the title's task names one; else the owner hears it.
                const target = d.to === 'claimant' ? await noteTarget(world, repoConfig, listed.title) : null;
                const to = target?.claimant ?? config.owner;
                const body = escalationBody(s, d.reason, d.field);
                report.did.push(
                    delivery(
                        'escalation',
                        await world.actions.escalate({ ...spec, reason: d.reason, to, body }, world.now()),
                    ),
                );
                return report;
            }
            // ponytail: ready / would-merge / merge are reported, not acted on. No PR reaches them
            // while no task link is trusted, and `live` is refused in the config.
            case 'skip':
            case 'wait':
            case 'ready':
            case 'would-merge':
            case 'merge':
                return report;
            default:
                d satisfies never;
                return report;
        }
    }
}

/** One pass over every configured repo. A PR that throws is reported and the pass goes on. */
export async function pass(world: World, config: LoopConfig): Promise<{ prs: PrReport[]; unread: string[] }> {
    const reports: PrReport[] = [];
    /** Repos whose open PRs could not be listed whole: "no PRs" there is not a finding. */
    const unread: string[] = [];
    const budget: PassBudget = { reviewsLeft: config.maxReviewsPerPass };
    for (const [repo, repoConfig] of Object.entries(config.repos)) {
        const inventory = await world.github.inventory(repo);
        if (!inventory.complete) unread.push(repo);
        // An incomplete listing may be missing PRs. Nothing here concludes anything from a PR's absence.
        for (const listed of inventory.prs) {
            if (listed.draft) continue;
            try {
                reports.push(await handle(world, config, repo, repoConfig, listed, budget));
            } catch (error) {
                reports.push({
                    repo,
                    pr: listed.number,
                    head: listed.head,
                    decision: 'none',
                    did: [`error: ${error instanceof Error ? error.message : 'unknown'}`],
                });
            }
        }
    }
    return { prs: reports, unread };
}
