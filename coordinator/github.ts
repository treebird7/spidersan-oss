/**
 * PR coordinator — reading GitHub (slice 4 of 4, part 2a).
 *
 * Pure parsers for the REST payloads a pass reads, and `GitHub`, which fetches them with
 * `gh api` through an injected `CommandRunner`, with the token of the repo's
 * owner. Nothing here writes.
 *
 * Fail closed: a payload that cannot be read whole gives `unknown`, `null` or
 * `complete: false`, never a default that reads as a result. Every listing is
 * one page of `PAGE` entries; a listing that fills the page, or disagrees with
 * the count GitHub gives for it, is not complete. CI's runs and jobs listings
 * are paged through, up to MAX_PAGES.
 * ponytail: one page elsewhere. Page through if a repo ever has 100 open PRs,
 * or a PR 100 files or a commit 100 statuses.
 */

import { isFullSha } from './decide';
import type { GateRead, PrRead, PrRef } from './effects';
import { isPrNumber, isRepoSlug } from './readers';
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

/**
 * A branch name as a URL path under `git/ref/heads/`: each `/`-separated part percent-encoded. Null when it is not a
 * name GitHub could hold: empty, an empty, `.` or `..` part, or a control character. A leading `_` or `.` is a name.
 */
export function branchPath(name: unknown): string | null {
    if (typeof name !== 'string' || name === '' || name.length > 255 || /[\x00-\x20\x7f]/.test(name)) return null;
    const parts = name.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
    return parts.map(encodeURIComponent).join('/');
}

/** A branch name GitHub could hold (`branchPath` reads it). Not an argv element: it only ever goes in a URL path. */
export function isBranch(value: unknown): value is string {
    return branchPath(value) !== null;
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
            !isBranch(base.ref) ||
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
        if (!isBranch(doc.base.ref) || typeof doc.changed_files !== 'number') return UNKNOWN;
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

// ── 3. CI: Actions jobs and commit statuses → readCi's observations ────────

export type Observations = Pick<CiInput, 'headSha' | 'observations' | 'expectedCount'>;

/**
 * The GitHub Actions app. Every Actions job is a check run it owns (a job's id is its check-run id),
 * but the jobs listing does not name the app, so its observations are stamped with this one.
 */
export const ACTIONS_APP_ID = 15368;
/** A paged listing longer than this is not read whole: no observations. */
export const MAX_PAGES = 10;

interface Observation {
    context: string;
    /** A commit status carries no app id. */
    appId: number | null;
    headSha: string;
    state: string;
}

/** One page of `{total_count, <key>: [...]}`, or null when it is not that. */
export function listingPage(stdout: unknown, key: string): { total: number; entries: readonly unknown[] } | null {
    const doc = parse(stdout);
    if (!isRecord(doc) || !Array.isArray(doc[key])) return null;
    // Any number: a total that is not a count never equals one, and the caller compares the two.
    const total = doc.total_count;
    if (typeof total !== 'number') return null;
    return { total, entries: doc[key] as readonly unknown[] };
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

const isId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

/** A run or job's state: `pending` until it completes, then its conclusion as GitHub gave it; null when it has none. */
function stateOf(status: unknown, conclusion: unknown): string | null {
    if (typeof status !== 'string') return null;
    if (status !== 'completed') return 'pending';
    return typeof conclusion === 'string' ? conclusion : null;
}

/**
 * Every workflow run on `head` (`GET /repos/{repo}/actions/runs?head_sha=…`), every job of
 * those runs (`GET …/actions/runs/{id}/jobs?filter=all`), and the commit statuses
 * (`GET /repos/{repo}/commits/{head}/status`) → the input `readCi` judges. A job is
 * observed under its name, the name its check run has, from the Actions app. Null when
 * any part cannot be read whole: a listing the caller could not page through, an entry
 * of the wrong shape, or one that names another commit or run.
 *
 * Re-runs. A re-run is a new attempt of the same workflow run: the same run id,
 * `run_attempt` one higher, and the runs listing reports the run at its current
 * attempt. `filter=all` lists every attempt's jobs, and only the jobs of the run's
 * current attempt count; an older attempt's job, green or red, is history. That
 * loses nothing GitHub still holds: "re-run failed jobs" copies the jobs it does not
 * re-run into the new attempt, with new ids and their old timestamps (Envoak run
 * 43420197808, attempt 2, 2026-11-13), so timestamps are no order either. A job a
 * re-run dropped keeps no stale green, and a required job only an older attempt has
 * is missing: no verdict. A job of an attempt newer than the run's means the runs
 * listing is older than the jobs listing: null. Two runs on one head (a `push` and a
 * `pull_request` run of one workflow) are not attempts of each other: both count,
 * and `readCi` wants a required context to agree across them.
 *
 * Every run adds an observation of its own state (`pending` until it completes, then its
 * conclusion) unless that is `success` and its current attempt lists jobs. So a run still
 * going keeps the commit incomplete whatever jobs it lists so far; a workflow that failed
 * or was cancelled is not green though every job it listed passed; and one whose current
 * attempt has no jobs (it failed to start, or a re-run was cancelled first) counts by its
 * conclusion. `readCi` judges these like any entry: `neutral` and `skipped` are not red,
 * `failure` is, and a state outside CI_STATES (`cancelled`, `timed_out`,
 * `startup_failure`, …) is no verdict. A run observation carries no app id and is named
 * `actions run <id>`, so it can never satisfy a required context. A required context that is neither a
 * job nor a status has no observation at all, and `readCi` gives it no verdict.
 *
 * ponytail: check runs from apps other than Actions (Socket Security on
 * spidersan-oss) are not seen: a fine-grained token cannot read check runs on a
 * private repo, and no repo requires one (2026-11-20). Read check runs again,
 * for public repos only, if one ever does.
 */
export function ciObservations(
    runs: readonly unknown[],
    jobs: readonly unknown[],
    statuses: unknown,
    head: string,
): Observations | null {
    if (!isFullSha(head)) return null;
    const observations: Observation[] = [];
    /** Run id → its current attempt, and how many jobs of that attempt are listed. */
    const current = new Map<number, { attempt: number; jobs: number }>();
    for (const run of runs) {
        if (!isRecord(run) || !isId(run.id) || run.head_sha !== head || current.has(run.id)) return null;
        if (!isId(run.run_attempt) || stateOf(run.status, run.conclusion) === null) return null;
        current.set(run.id, { attempt: run.run_attempt, jobs: 0 });
    }
    const ids = new Set<number>();
    for (const job of jobs) {
        if (!isRecord(job) || !isId(job.id) || ids.has(job.id) || job.head_sha !== head) return null;
        const run = isId(job.run_id) ? current.get(job.run_id) : undefined;
        if (run === undefined || !isId(job.run_attempt) || job.run_attempt > run.attempt) return null;
        if (typeof job.name !== 'string' || job.name === '') return null;
        const state = stateOf(job.status, job.conclusion);
        if (state === null) return null;
        ids.add(job.id);
        if (job.run_attempt !== run.attempt) continue;
        run.jobs += 1;
        observations.push({ context: job.name, appId: ACTIONS_APP_ID, headSha: head, state });
    }
    for (const run of runs as readonly Record<string, unknown>[]) {
        const state = stateOf(run.status, run.conclusion) as string;
        // A run's own state stands beside its jobs unless it is plainly success with jobs listed: a failed workflow
        // whose listed jobs all passed (it failed expanding a later one) is not green (#361).
        if (state !== 'success' || current.get(run.id as number)?.jobs === 0) {
            observations.push({ context: `actions run ${run.id as number}`, appId: null, headSha: head, state });
        }
    }
    const latestStatuses = statusEntries(statuses, head);
    if (latestStatuses === null) return null;
    for (const s of latestStatuses) {
        observations.push({ context: s.context, appId: null, headSha: head, state: s.state });
    }
    return { headSha: head, observations, expectedCount: observations.length };
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

/**
 * Every `gh api` call names its host: github.com, the host the tokens are for. Without it `gh` sends the request,
 * and its own login for that host, wherever `GH_HOST` or its config points (sp-vkqq, prsan #361 P1-1).
 */
export const GITHUB_HOST = ['--hostname', 'github.com'] as const;

/** The token for a repo's owner, or undefined when there is none. */
export type TokenFor = (repo: string) => string | undefined;

const GITHUB_TOKEN_FORMAT = /^(?:github_pat_[A-Za-z0-9_]{60,240}|gh[opsu]_[A-Za-z0-9]{30,240})$/;

/**
 * A GitHub token, by its own prefix: a fine-grained PAT (`github_pat_`), or a classic PAT, OAuth, app or
 * user-to-server token (`ghp_`, `gho_`, `ghs_`, `ghu_`). Anything else is not sent to GitHub at all: a variable
 * mapped by mistake to another service's credential (prsan #361) never leaves the host. An empty `GH_TOKEN` would
 * also make `gh` fall back to its stored login.
 */
export function isToken(value: unknown): value is string {
    return typeof value === 'string' && GITHUB_TOKEN_FORMAT.test(value);
}

/**
 * Reads one repo host through `gh api`. Every path is built from checked parts; a failed call is `undefined`.
 *
 * Each call runs with the token of the repo it reads, as `GH_TOKEN` in that run's environment only (sp-vkqq).
 * A repo with no usable token is not read at all: `gh` would otherwise use whatever login the host has.
 */
export class GitHub {
    readonly #run: CommandRunner;
    readonly #token: TokenFor;

    constructor(run: CommandRunner, token: TokenFor) {
        this.#run = run;
        this.#token = token;
    }

    async #get(repo: string, path: string, accept?: string): Promise<unknown> {
        try {
            const githubToken = this.#token(repo);
            if (!isToken(githubToken)) return undefined;
            const argv = accept === undefined ? ['api', path] : ['api', '-H', `Accept: ${accept}`, path];
            argv.push(...GITHUB_HOST);
            const result: unknown = await this.#run('gh', argv, { cwd: '/', githubToken });
            return isRecord(result) && result.exitCode === 0 ? result.stdout : undefined;
        } catch {
            return undefined;
        }
    }

    async inventory(repo: string): Promise<Inventory> {
        if (!isRepoSlug(repo)) return { complete: false, prs: [] };
        return parseInventory(await this.#get(repo, `repos/${repo}/pulls?state=open&per_page=${PAGE}`), repo);
    }

    async detail(ref: PrRef): Promise<PrDetail> {
        if (!isRecord(ref) || !isRepoSlug(ref.repo) || !isPrNumber(ref.pr)) return UNKNOWN;
        return parsePr(await this.#get(ref.repo, `repos/${ref.repo}/pulls/${ref.pr}`), ref);
    }

    /** `EffectReader.readPr`: an open PR's `base` is the tip of its base branch right now. */
    async readPr(ref: PrRef): Promise<PrRead> {
        const detail = await this.detail(ref);
        if (detail.kind !== 'open') return detail;
        const path = branchPath(detail.baseRef);
        if (path === null) return UNKNOWN;
        const tip = await this.#get(ref.repo, `repos/${ref.repo}/git/ref/heads/${path}`);
        const base = parseBranchTip(tip, detail.baseRef);
        return base === null ? UNKNOWN : { kind: 'open', head: detail.head, base };
    }

    /** The PR's diff as text, for triage; undefined when it cannot be read. Which head it is for is the caller's to check. */
    async diff(ref: PrRef): Promise<string | undefined> {
        if (!isRecord(ref) || !isRepoSlug(ref.repo) || !isPrNumber(ref.pr)) return undefined;
        const text = await this.#get(ref.repo, `repos/${ref.repo}/pulls/${ref.pr}`, 'application/vnd.github.diff');
        return typeof text === 'string' && text !== '' ? text : undefined;
    }

    /**
     * Every entry of a paged listing (`path` has a query; `&page=N` is added), or null when a page
     * cannot be read, the pages disagree on the total, or they do not add up to it within MAX_PAGES.
     */
    async #all(repo: string, path: string, key: string): Promise<unknown[] | null> {
        const entries: unknown[] = [];
        let total: number | null = null;
        for (let n = 1; n <= MAX_PAGES; n++) {
            const page = listingPage(await this.#get(repo, `${path}&page=${n}`), key);
            if (page === null || (total !== null && page.total !== total) || page.entries.length > PAGE) return null;
            total = page.total;
            entries.push(...page.entries);
            if (page.entries.length < PAGE) return entries.length === total ? entries : null;
        }
        return null;
    }

    /** CI on `head` from Actions runs and jobs plus commit statuses (sp-cabo); see `ciObservations`. */
    async ci(repo: string, head: string): Promise<Observations | null> {
        if (!isRepoSlug(repo) || !isFullSha(head)) return null;
        const listing = `repos/${repo}/actions/runs?head_sha=${head}&per_page=${PAGE}`;
        const runs = await this.#all(repo, listing, 'workflow_runs');
        if (runs === null) return null;
        const jobs: unknown[] = [];
        for (const run of runs) {
            const id = isRecord(run) ? run.id : undefined;
            if (!isId(id)) return null;
            const path = `repos/${repo}/actions/runs/${id}/jobs?filter=all&per_page=${PAGE}`;
            const list = await this.#all(repo, path, 'jobs');
            // Each job must be of the run whose endpoint listed it, not merely of some listed run.
            if (list === null || !list.every((job) => isRecord(job) && job.run_id === id)) return null;
            jobs.push(...list);
        }
        return ciObservations(runs, jobs, await this.#statuses(repo, head), head);
    }

    #statuses(repo: string, head: string): Promise<unknown> {
        return this.#get(repo, `repos/${repo}/commits/${head}/status?per_page=${PAGE}`);
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
        const list = await this.#get(ref.repo, `repos/${ref.repo}/pulls/${ref.pr}/files?per_page=${PAGE}`);
        const after = await this.detail(ref);
        if (after.kind !== 'open' || after.head !== before.head || after.changedFiles !== before.changedFiles) {
            return { headSha: before.head, files: null, expectedCount: -1 };
        }
        return parseFiles(list, before.head, before.changedFiles);
    }
}
