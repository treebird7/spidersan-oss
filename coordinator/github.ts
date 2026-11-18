/**
 * PR coordinator — reading GitHub (slice 4 of 4, part 2a).
 *
 * Pure parsers for five REST payloads, and `GitHub`, which fetches them with
 * `gh api` through an injected `CommandRunner`. Nothing here writes.
 *
 * Fail closed: a payload that cannot be read whole gives `unknown`, `null` or
 * `complete: false`, never a default that reads as a result. Every listing is
 * one page of `PAGE` entries; a listing that fills the page, or disagrees with
 * the count GitHub gives for it, is not complete.
 * ponytail: one page. Follow the `Link` header if a repo ever has 100 open
 * PRs, or a PR 100 files or 100 check runs.
 */

import { isFullSha } from './decide';
import type { GateRead, PrRead, PrRef } from './effects';
import { isGitRef, isPrNumber, isRepoSlug } from './readers';
import type { CiInput, CommandRunner, TouchesInput } from './readers';

export const PAGE = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(stdout: unknown): unknown {
    if (typeof stdout !== 'string') return undefined;
    try {
        return JSON.parse(stdout);
    } catch {
        return undefined;
    }
}

/** `full_name` of a payload's repo object; null when the repo is gone (a deleted fork). */
function repoName(side: unknown): string | null {
    return isRecord(side) && isRecord(side.repo) && typeof side.repo.full_name === 'string'
        ? side.repo.full_name
        : null;
}

// ── 1. Open-PR inventory ───────────────────────────────────────────────────

export interface InventoryPr {
    number: number;
    draft: boolean;
    /** The head branch is not in this repo (or its repo is gone). */
    fork: boolean;
    head: string;
    baseRef: string;
    /** Author-controlled text. '' when the payload has none. */
    title: string;
}

export interface Inventory {
    /** False: the listing may be missing PRs, so nothing may be concluded from a PR's absence. */
    complete: boolean;
    prs: InventoryPr[];
}

/** `GET /repos/{repo}/pulls?state=open&per_page=100` → the open PRs. An entry that cannot be read marks the listing incomplete. */
export function parseInventory(stdout: unknown, repo: string): Inventory {
    const list = parse(stdout);
    if (!Array.isArray(list)) return { complete: false, prs: [] };
    const prs: InventoryPr[] = [];
    let complete = list.length < PAGE;
    for (const entry of list as readonly unknown[]) {
        const head = isRecord(entry) && isRecord(entry.head) ? entry.head : null;
        const base = isRecord(entry) && isRecord(entry.base) ? entry.base : null;
        if (
            !isRecord(entry) ||
            head === null ||
            base === null ||
            entry.state !== 'open' ||
            !isPrNumber(entry.number) ||
            typeof entry.draft !== 'boolean' ||
            !isFullSha(head.sha) ||
            !isGitRef(base.ref) ||
            repoName(base) !== repo
        ) {
            complete = false;
            continue;
        }
        prs.push({
            number: entry.number,
            draft: entry.draft,
            fork: repoName(head) !== repo,
            head: head.sha,
            baseRef: base.ref,
            title: typeof entry.title === 'string' ? entry.title : '',
        });
    }
    if (new Set(prs.map((pr) => pr.number)).size !== prs.length) return { complete: false, prs: [] };
    return { complete, prs };
}

// ── 2. One PR ──────────────────────────────────────────────────────────────

export type PrDetail =
    | { kind: 'open'; head: string; baseRef: string; changedFiles: number }
    | { kind: 'merged'; head: string; mergeCommit: string }
    | { kind: 'closed' }
    | { kind: 'unknown' };

const UNKNOWN = { kind: 'unknown' } as const;

/** `GET /repos/{repo}/pulls/{pr}` → the PR. `unknown` unless it is this PR in this repo and reads whole. */
export function parsePr(stdout: unknown, ref: PrRef): PrDetail {
    const doc = parse(stdout);
    if (!isRecord(doc) || doc.number !== ref.pr || !isRecord(doc.head) || !isRecord(doc.base)) return UNKNOWN;
    if (repoName(doc.base) !== ref.repo || !isFullSha(doc.head.sha)) return UNKNOWN;
    const head = doc.head.sha;
    if (doc.state === 'open' && doc.merged === false) {
        if (!isGitRef(doc.base.ref) || typeof doc.changed_files !== 'number') return UNKNOWN;
        if (!Number.isSafeInteger(doc.changed_files) || doc.changed_files < 0) return UNKNOWN;
        return { kind: 'open', head, baseRef: doc.base.ref, changedFiles: doc.changed_files };
    }
    if (doc.state !== 'closed') return UNKNOWN;
    if (doc.merged === false) return { kind: 'closed' };
    if (doc.merged !== true || !isFullSha(doc.merge_commit_sha)) return UNKNOWN;
    return { kind: 'merged', head, mergeCommit: doc.merge_commit_sha };
}

/** `GET /repos/{repo}/git/ref/heads/{ref}` → the branch tip, or null. */
export function parseBranchTip(stdout: unknown, baseRef: string): string | null {
    const doc = parse(stdout);
    if (!isRecord(doc) || doc.ref !== `refs/heads/${baseRef}` || !isRecord(doc.object)) return null;
    return doc.object.type === 'commit' && isFullSha(doc.object.sha) ? doc.object.sha : null;
}

// ── 3. CI: check runs and commit statuses → readCi's observations ──────────

export type Observations = Pick<CiInput, 'headSha' | 'observations' | 'expectedCount'>;

interface Observation {
    context: string;
    /** A commit status carries no app id. */
    appId: number | null;
    headSha: string;
    state: string;
}

/** Latest commit statuses for `head`, or null when the listing is not whole. */
function statusEntries(stdout: unknown, head: string): { context: string; state: string }[] | null {
    const doc = parse(stdout);
    if (!isRecord(doc) || doc.sha !== head || !Array.isArray(doc.statuses)) return null;
    if (doc.total_count !== doc.statuses.length || doc.statuses.length >= PAGE) return null;
    const out: { context: string; state: string }[] = [];
    for (const s of doc.statuses as readonly unknown[]) {
        if (!isRecord(s) || typeof s.context !== 'string' || s.context === '' || typeof s.state !== 'string')
            return null;
        out.push({ context: s.context, state: s.state });
    }
    return out;
}

/**
 * `GET /repos/{repo}/commits/{head}/check-runs?per_page=100` and
 * `GET /repos/{repo}/commits/{head}/status?per_page=100` → the input `readCi`
 * judges. Null when either cannot be read at all. A listing that is not whole
 * is passed on with an `expectedCount` that `readCi` refuses.
 *
 * A run that has not completed is `pending`. Any other state is passed on as
 * GitHub gave it (`cancelled`, `timed_out`, `error`, …): `readCi` gives no
 * verdict on a state it does not know.
 */
export function ciObservations(checkRuns: unknown, statuses: unknown, head: string): Observations | null {
    const runs = parse(checkRuns);
    if (!isFullSha(head) || !isRecord(runs) || !Array.isArray(runs.check_runs)) return null;
    if (typeof runs.total_count !== 'number') return null;
    const observations: Observation[] = [];
    for (const run of runs.check_runs as readonly unknown[]) {
        if (!isRecord(run) || typeof run.name !== 'string' || typeof run.head_sha !== 'string') return null;
        if (!isRecord(run.app) || typeof run.app.id !== 'number' || typeof run.status !== 'string') return null;
        if (run.status === 'completed' && typeof run.conclusion !== 'string') return null;
        observations.push({
            context: run.name,
            appId: run.app.id,
            headSha: run.head_sha,
            state: run.status === 'completed' ? (run.conclusion as string) : 'pending',
        });
    }
    const latest = statusEntries(statuses, head);
    if (latest === null) return null;
    for (const s of latest) observations.push({ context: s.context, appId: null, headSha: head, state: s.state });
    const whole = runs.check_runs.length < PAGE;
    return { headSha: head, observations, expectedCount: whole ? runs.total_count + latest.length : -1 };
}

/** The merge-gate commit status on `head`: `success`, `clear` (anything else, or absent), or `unknown`. */
export function parseGate(statuses: unknown, head: string, gateContext: string): GateRead {
    const latest = statusEntries(statuses, head);
    if (latest === null) return UNKNOWN;
    const gate = latest.filter((s) => s.context === gateContext);
    if (gate.length > 1) return UNKNOWN;
    return { kind: gate[0]?.state === 'success' ? 'success' : 'clear' };
}

// ── 4. Changed files → classifyTouches' input ──────────────────────────────

/**
 * `GET /repos/{repo}/pulls/{pr}/files?per_page=100` → the changed paths at
 * `head` (a rename gives both paths). `changedFiles` is the PR's own count:
 * when the listing does not have that many entries, `expectedCount` is one
 * `classifyTouches` refuses, and it fails closed.
 */
export function parseFiles(stdout: unknown, head: string, changedFiles: number): TouchesInput {
    const list = parse(stdout);
    const closed: TouchesInput = { headSha: head, files: null, expectedCount: -1 };
    if (!Array.isArray(list) || list.length !== changedFiles || list.length >= PAGE) return closed;
    const files: string[] = [];
    for (const entry of list as readonly unknown[]) {
        if (!isRecord(entry) || typeof entry.filename !== 'string') return closed;
        files.push(entry.filename);
        if (entry.previous_filename === undefined) continue;
        if (typeof entry.previous_filename !== 'string') return closed;
        files.push(entry.previous_filename);
    }
    return { headSha: head, files, expectedCount: files.length };
}

// ── Fetching ───────────────────────────────────────────────────────────────

/** Reads one repo host through `gh api`. Every path is built from checked parts; a failed call is `undefined`. */
export class GitHub {
    readonly #run: CommandRunner;

    constructor(run: CommandRunner) {
        this.#run = run;
    }

    async #get(path: string, accept?: string): Promise<unknown> {
        try {
            const argv = accept === undefined ? ['api', path] : ['api', '-H', `Accept: ${accept}`, path];
            const result: unknown = await this.#run('gh', argv, { cwd: '/' });
            return isRecord(result) && result.exitCode === 0 ? result.stdout : undefined;
        } catch {
            return undefined;
        }
    }

    async inventory(repo: string): Promise<Inventory> {
        if (!isRepoSlug(repo)) return { complete: false, prs: [] };
        return parseInventory(await this.#get(`repos/${repo}/pulls?state=open&per_page=${PAGE}`), repo);
    }

    async detail(ref: PrRef): Promise<PrDetail> {
        if (!isRecord(ref) || !isRepoSlug(ref.repo) || !isPrNumber(ref.pr)) return UNKNOWN;
        return parsePr(await this.#get(`repos/${ref.repo}/pulls/${ref.pr}`), ref);
    }

    /** `EffectReader.readPr`: an open PR's `base` is the tip of its base branch right now. */
    async readPr(ref: PrRef): Promise<PrRead> {
        const detail = await this.detail(ref);
        if (detail.kind !== 'open') return detail;
        const base = parseBranchTip(
            await this.#get(`repos/${ref.repo}/git/ref/heads/${detail.baseRef}`),
            detail.baseRef,
        );
        return base === null ? UNKNOWN : { kind: 'open', head: detail.head, base };
    }

    /** The PR's diff as text, for triage; undefined when it cannot be read. Which head it is for is the caller's to check. */
    async diff(ref: PrRef): Promise<string | undefined> {
        if (!isRecord(ref) || !isRepoSlug(ref.repo) || !isPrNumber(ref.pr)) return undefined;
        const text = await this.#get(`repos/${ref.repo}/pulls/${ref.pr}`, 'application/vnd.github.diff');
        return typeof text === 'string' && text !== '' ? text : undefined;
    }

    async ci(repo: string, head: string): Promise<Observations | null> {
        if (!isRepoSlug(repo) || !isFullSha(head)) return null;
        const runs = await this.#get(`repos/${repo}/commits/${head}/check-runs?per_page=${PAGE}`);
        return ciObservations(runs, await this.#statuses(repo, head), head);
    }

    #statuses(repo: string, head: string): Promise<unknown> {
        return this.#get(`repos/${repo}/commits/${head}/status?per_page=${PAGE}`);
    }

    async gate(at: { repo: string; head: string }, gateContext: string): Promise<GateRead> {
        if (!isRecord(at) || !isRepoSlug(at.repo) || !isFullSha(at.head) || gateContext === '') return UNKNOWN;
        return parseGate(await this.#statuses(at.repo, at.head), at.head, gateContext);
    }

    /**
     * The changed paths of an open PR; null when the PR is not open. The PR is
     * read before and after the listing: if its head or file count moved in
     * between, the listing is for neither head and the result fails closed.
     */
    async files(ref: PrRef): Promise<TouchesInput | null> {
        const before = await this.detail(ref);
        if (before.kind !== 'open') return null;
        const list = await this.#get(`repos/${ref.repo}/pulls/${ref.pr}/files?per_page=${PAGE}`);
        const after = await this.detail(ref);
        if (after.kind !== 'open' || after.head !== before.head || after.changedFiles !== before.changedFiles) {
            return { headSha: before.head, files: null, expectedCount: -1 };
        }
        return parseFiles(list, before.head, before.changedFiles);
    }
}
