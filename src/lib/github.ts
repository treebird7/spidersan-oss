/**
 * GitHub API client wrapper using `gh` CLI
 *
 * Provides access to branch, PR, and CI status from GitHub
 * without requiring Octokit or managing authentication.
 */

import { execFileSync } from 'child_process';
import { validateBranchName, validatePRNumber } from './security.js';

/**
 * Env-gated debug breadcrumb (mirrors the DEBUG_COLONY convention). Off by
 * default so normal runs stay quiet; set DEBUG_GITHUB=1 to surface the reason a
 * gh call failed instead of having it swallowed into a benign-looking default.
 */
function debugGitHub(message: string, detail?: unknown): void {
    if (!process.env.DEBUG_GITHUB) return;
    const suffix = detail instanceof Error
        ? `: ${detail.message}`
        : detail !== undefined ? `: ${String(detail)}` : '';
    console.error(`[github] ${message}${suffix}`);
}

export interface GitHubRepoConfig {
    owner: string;
    repo: string;
}

export interface GitHubBranchInfo {
    name: string;
    sha: string;
    protected: boolean;
    commit: {
        sha: string;
        date: string;
        author: string;
        message: string;
    };
}

export interface GitHubPRInfo {
    number: number;
    title: string;
    state: string;
    headBranch: string;
    draft: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface GitHubCIStatus {
    status: string;
    conclusion: string | null;
    url: string;
    runId: string;
    createdAt: string;
}

export interface GitHubCommitInfo {
    sha: string;
    date: string;
    author: string;
    message: string;
}

export interface AheadBehind {
    ahead: number;
    behind: number;
}

export interface GitHubPRDetails {
    number: number;
    title: string;
    headBranch: string;
    files: string[];
}

/**
 * Check if GitHub CLI (gh) is available and authenticated.
 */
export function isGhAvailable(): boolean {
    try {
        execFileSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: 'pipe' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Fetch all branches from a GitHub repository.
 */
export async function listBranches(config: GitHubRepoConfig): Promise<GitHubBranchInfo[]> {
    try {
        const output = execFileSync('gh', [
            'api',
            `repos/${config.owner}/${config.repo}/branches`,
            '--paginate',
            '--jq',
            '.[] | {name: .name, sha: .commit.sha, protected: .protected}',
        ], { encoding: 'utf-8' });

        const branches: GitHubBranchInfo[] = [];
        const lines = output.trim().split('\n').filter(l => l.length > 0);
        for (const line of lines) {
            try {
                const data = JSON.parse(line);
                branches.push({
                    name: data.name,
                    sha: data.sha,
                    protected: data.protected,
                    commit: { sha: data.sha, date: '', author: '', message: '' },
                });
            } catch {
                // Skip invalid JSON lines
            }
        }
        return branches;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to list branches: ${msg}`);
    }
}

/**
 * Fetch commit details for a specific branch.
 */
export async function getCommitInfo(config: GitHubRepoConfig, branch: string): Promise<GitHubCommitInfo | null> {
    try {
        const safeBranch = validateBranchName(branch);
        const output = execFileSync('gh', [
            'api',
            `repos/${config.owner}/${config.repo}/commits/${safeBranch}`,
            '--jq',
            '{sha: .sha, date: .commit.author.date, author: .commit.author.name, message: .commit.message}',
        ], { encoding: 'utf-8' });
        try {
            return JSON.parse(output);
        } catch {
            return null;
        }
    } catch {
        return null;
    }
}

/**
 * Fetch all pull requests for a repository.
 */
export async function listPullRequests(config: GitHubRepoConfig): Promise<GitHubPRInfo[]> {
    try {
        const output = execFileSync('gh', [
            'pr', 'list',
            '--repo', `${config.owner}/${config.repo}`,
            '--state', 'all',
            '--json', 'number,title,state,headRefName,isDraft,createdAt,updatedAt',
            '--limit', '1000',
        ], { encoding: 'utf-8' });
        try {
            const data = JSON.parse(output);
            return data.map((pr: Record<string, unknown>) => ({
                number: pr.number,
                title: pr.title,
                state: pr.state,
                headBranch: pr.headRefName,
                draft: pr.isDraft,
                createdAt: pr.createdAt,
                updatedAt: pr.updatedAt,
            }));
        } catch {
            return [];
        }
    } catch {
        return [];
    }
}

/**
 * Get CI status for a branch (from latest workflow run).
 */
export async function getCIStatus(config: GitHubRepoConfig, branch: string): Promise<GitHubCIStatus | null> {
    try {
        const safeBranch = validateBranchName(branch);
        const output = execFileSync('gh', [
            'run', 'list',
            '--repo', `${config.owner}/${config.repo}`,
            '--branch', safeBranch,
            '--limit', '1',
            '--json', 'status,conclusion,url,databaseId,createdAt',
        ], { encoding: 'utf-8' });
        try {
            const data = JSON.parse(output);
            if (!Array.isArray(data) || data.length === 0) return null;
            const run = data[0];
            return {
                status: run.status,
                conclusion: run.conclusion,
                url: run.url,
                runId: String(run.databaseId),
                createdAt: run.createdAt,
            };
        } catch {
            return null;
        }
    } catch {
        return null;
    }
}

/**
 * Compare a branch to main (or specified base) and get ahead/behind counts.
 *
 * Returns `null` when the comparison could not be determined — an invalid
 * branch name, a gh transport/auth/rate-limit failure, or unparseable output.
 * This is deliberately distinct from `{ ahead: 0, behind: 0 }`, which means the
 * branch is genuinely in sync. Callers MUST NOT treat `null` as "in sync": a
 * rate-limited or 403'd compare would otherwise mislabel a diverged branch as
 * clean. Set DEBUG_GITHUB=1 to see the underlying failure.
 */
export async function getAheadBehind(config: GitHubRepoConfig, branch: string, baseBranch = 'main'): Promise<AheadBehind | null> {
    let safeBranch: string;
    let safeBaseBranch: string;
    try {
        safeBranch = validateBranchName(branch);
        safeBaseBranch = validateBranchName(baseBranch);
    } catch (error) {
        debugGitHub('getAheadBehind: invalid branch name', error);
        return null;
    }

    const range = `${safeBaseBranch}...${safeBranch}`;
    let output: string;
    try {
        output = execFileSync('gh', [
            'api',
            `repos/${config.owner}/${config.repo}/compare/${range}`,
            '--jq',
            '{ahead: .ahead_by, behind: .behind_by}',
        ], { encoding: 'utf-8', stdio: 'pipe' });
    } catch (error) {
        // Transport / auth / rate-limit failure — surface as "unknown", NOT {0,0}.
        debugGitHub(`getAheadBehind(${range}): gh compare failed`, error);
        return null;
    }

    try {
        const data = JSON.parse(output);
        // jq emits `null` for a missing ahead_by/behind_by — treat that as
        // "couldn't determine", not 0. (Number(null) === 0 would mask it.)
        if (typeof data.ahead !== 'number' || typeof data.behind !== 'number'
            || !Number.isFinite(data.ahead) || !Number.isFinite(data.behind)) {
            debugGitHub(`getAheadBehind(${range}): non-numeric compare result`, output.trim());
            return null;
        }
        return { ahead: data.ahead, behind: data.behind };
    } catch (error) {
        debugGitHub(`getAheadBehind(${range}): unparseable compare output`, error);
        return null;
    }
}

/**
 * Fetch details for a specific pull request: head branch name and list of changed files.
 * Requires `gh` CLI to be authenticated and run from inside the repository directory.
 */
export async function getPRDetails(prNumber: number): Promise<GitHubPRDetails> {
    const safePrNumber = validatePRNumber(prNumber);

    // Get PR metadata (head branch, title, number)
    let prOutput: string;
    try {
        prOutput = execFileSync('gh', [
            'pr', 'view',
            '--json', 'headRefName,title,number',
            '--', String(safePrNumber)
        ], { encoding: 'utf-8' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch PR #${safePrNumber} metadata: ${msg}`);
    }

    const prData = JSON.parse(prOutput) as { headRefName: string; title: string; number: number };

    // Get changed file paths via the diff (--name-only lists one file per line)
    let diffOutput: string;
    try {
        diffOutput = execFileSync('gh', [
            'pr', 'diff',
            '--name-only',
            '--', String(safePrNumber)
        ], { encoding: 'utf-8' });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch changed files for PR #${prNumber}: ${msg}`);
    }

    const files = diffOutput.trim().split('\n').filter(f => f.length > 0);

    return {
        number: prData.number,
        title: prData.title,
        headBranch: prData.headRefName,
        files,
    };
}

/** A lightweight open-PR entry (no file list — fetch that via getPRChangedFiles). */
export interface OpenPR {
    number: number;
    title: string;
    headBranch: string;
    draft: boolean;
}

/**
 * Open PRs in the current repo. cwd-based `gh` (same convention as getPRDetails,
 * so no GitHubRepoConfig plumbing needed). Empty array on any failure.
 */
export async function listOpenPRs(): Promise<OpenPR[]> {
    try {
        const out = execFileSync('gh', [
            'pr', 'list', '--state', 'open',
            '--json', 'number,title,headRefName,isDraft',
            '--limit', '200',
        ], { encoding: 'utf-8' });
        const data = JSON.parse(out) as Array<{ number: number; title: string; headRefName: string; isDraft: boolean }>;
        return data.map(p => ({ number: p.number, title: p.title, headBranch: p.headRefName, draft: p.isDraft }));
    } catch {
        return [];
    }
}

/** Changed file paths for a PR (diff only — leaner than getPRDetails). Empty on failure. */
export async function getPRChangedFiles(prNumber: number): Promise<string[]> {
    const safePrNumber = validatePRNumber(prNumber);
    try {
        const out = execFileSync('gh', ['pr', 'diff', '--name-only', '--', String(safePrNumber)], { encoding: 'utf-8' });
        return out.trim().split('\n').filter(f => f.length > 0);
    } catch {
        return [];
    }
}

// ---------------------------------------------------------------------------
// PR merge-state + CI rollup (Feature 3 / A2)
// ---------------------------------------------------------------------------

/**
 * Merge readiness of a PR: stacked-base detection, conflict/red state, and a
 * defensively-parsed CI check rollup. Backs `spidersan pr-check`.
 */
export interface PRMergeState {
    number: number;
    title: string;
    /** Base branch the PR merges into. != trunk ⇒ stacked PR. */
    baseRefName: string;
    headRefName: string;
    /** GitHub mergeability (computed async; can briefly be UNKNOWN). */
    mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
    /** Combined merge-state status from GitHub. */
    mergeStateStatus:
        | 'CLEAN' | 'UNSTABLE' | 'DIRTY' | 'BEHIND'
        | 'BLOCKED' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN';
    /** Per-check buckets (heterogeneous CheckRun + StatusContext nodes). */
    checks: { name: string; bucket: 'pass' | 'fail' | 'pending' | 'skipping'; required: boolean }[];
    /** Aggregate rollup. `failingRequired` = names of failing *required* checks only. */
    checkRollup: { pass: number; fail: number; pending: number; failingRequired: string[] };
    /** PR head SHA (for fork-safe conflict analysis in merge-plan). */
    headRefOid?: string;
}

/** Raw shape of a single `statusCheckRollup` node (fields are all optional). */
interface RollupNode {
    name?: string;
    context?: string;
    // CheckRun: status/conclusion. StatusContext: state.
    status?: string | null;
    conclusion?: string | null;
    state?: string | null;
    isRequired?: boolean;
}

/** Short delay before re-polling when mergeable is UNKNOWN. Overridable for tests. */
let unknownRepollDelayMs = 1500;

/** @internal test hook — set the UNKNOWN re-poll delay (keeps the suite fast). */
export function __setUnknownRepollDelayForTests(ms: number): void {
    unknownRepollDelayMs = ms;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Bucket one rollup node into pass/fail/pending/skipping from whichever of
 * `conclusion` / `state` / `status` is present (nodes are heterogeneous and
 * any field may be null/absent). Never throws.
 */
function bucketRollupNode(node: RollupNode): 'pass' | 'fail' | 'pending' | 'skipping' {
    // Prefer the terminal conclusion; CheckRuns report status=COMPLETED + a conclusion,
    // or status=QUEUED/IN_PROGRESS with a null conclusion. StatusContexts use `state`.
    const signal = (node.conclusion ?? node.state ?? node.status ?? '')
        .toString()
        .toUpperCase();

    switch (signal) {
        case 'SUCCESS':
            return 'pass';
        case 'FAILURE':
        case 'ERROR':
        case 'CANCELLED':
        case 'TIMED_OUT':
        case 'ACTION_REQUIRED':
        case 'STARTUP_FAILURE':
            return 'fail';
        case 'NEUTRAL':
        case 'SKIPPED':
            return 'skipping';
        case 'PENDING':
        case 'IN_PROGRESS':
        case 'QUEUED':
        case 'REQUESTED':
        case 'WAITING':
        case 'EXPECTED':
            return 'pending';
        default:
            // null conclusion on a not-yet-complete run, or an unknown signal → pending.
            return 'pending';
    }
}

function parseRollup(rollup: unknown): Pick<PRMergeState, 'checks' | 'checkRollup'> {
    const checks: PRMergeState['checks'] = [];
    const rollupAgg = { pass: 0, fail: 0, pending: 0, failingRequired: [] as string[] };

    const nodes: RollupNode[] = Array.isArray(rollup) ? (rollup as RollupNode[]) : [];
    for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const name = node.name ?? node.context ?? 'unknown';
        // isRequired is OFTEN ABSENT → default false.
        const required = node.isRequired === true;
        const bucket = bucketRollupNode(node);

        checks.push({ name, bucket, required });

        if (bucket === 'pass') rollupAgg.pass++;
        else if (bucket === 'fail') {
            rollupAgg.fail++;
            // Only fail + required feeds failingRequired.
            if (required) rollupAgg.failingRequired.push(name);
        } else if (bucket === 'pending') rollupAgg.pending++;
        // 'skipping' counts toward none of pass/fail/pending.
    }

    return { checks, checkRollup: rollupAgg };
}

function normalizeMergeable(v: unknown): PRMergeState['mergeable'] {
    return v === 'MERGEABLE' || v === 'CONFLICTING' ? v : 'UNKNOWN';
}

function normalizeMergeStateStatus(v: unknown): PRMergeState['mergeStateStatus'] {
    const allowed = ['CLEAN', 'UNSTABLE', 'DIRTY', 'BEHIND', 'BLOCKED', 'DRAFT', 'HAS_HOOKS'];
    return typeof v === 'string' && allowed.includes(v)
        ? (v as PRMergeState['mergeStateStatus'])
        : 'UNKNOWN';
}

/** Single `gh pr view --json …` call. Returns parsed JSON, or null on any failure. */
function fetchPRMergeJson(prNumber: number, repo?: string): Record<string, unknown> | null {
    const args = ['pr', 'view'];
    if (repo) {
        args.push('--repo', repo);
    }
    args.push(
        '--json',
        'number,title,baseRefName,headRefName,headRefOid,mergeable,mergeStateStatus,statusCheckRollup',
        '--',
        String(prNumber),
    );
    try {
        const out = execFileSync('gh', args, { encoding: 'utf-8', stdio: 'pipe' });
        return JSON.parse(out) as Record<string, unknown>;
    } catch {
        return null;
    }
}

/**
 * Fetch a PR's merge readiness: base branch (for stacked-PR detection),
 * mergeable/merge-state status, and a defensively-bucketed CI rollup.
 *
 * One `gh pr view --json …` call. When `opts.repo` ("owner/name") is given it
 * is passed as `--repo`. Re-polls once when `mergeable === 'UNKNOWN'` (GitHub
 * computes it asynchronously), then reports as-is.
 *
 * @returns the merge state, or `null` if gh is unavailable or the PR isn't found.
 */
export async function getPRMergeState(
    prNumber: number,
    opts?: { repo?: string },
): Promise<PRMergeState | null> {
    if (!isGhAvailable()) return null;

    const safePrNumber = validatePRNumber(prNumber);
    const repo = opts?.repo;

    let data = fetchPRMergeJson(safePrNumber, repo);
    if (!data) return null;

    // GitHub computes mergeability async — re-poll once if still UNKNOWN.
    if (normalizeMergeable(data.mergeable) === 'UNKNOWN') {
        await sleep(unknownRepollDelayMs);
        const second = fetchPRMergeJson(safePrNumber, repo);
        if (second) data = second;
    }

    const { checks, checkRollup } = parseRollup(data.statusCheckRollup);

    return {
        number: typeof data.number === 'number' ? data.number : safePrNumber,
        title: typeof data.title === 'string' ? data.title : '',
        baseRefName: typeof data.baseRefName === 'string' ? data.baseRefName : '',
        headRefName: typeof data.headRefName === 'string' ? data.headRefName : '',
        mergeable: normalizeMergeable(data.mergeable),
        mergeStateStatus: normalizeMergeStateStatus(data.mergeStateStatus),
        checks,
        checkRollup,
        headRefOid: typeof data.headRefOid === 'string' ? data.headRefOid : undefined,
    };
}
