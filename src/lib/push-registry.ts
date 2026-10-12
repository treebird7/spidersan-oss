/**
 * Register every pushed branch in spider_registries from git-watch, so a branch
 * pushed by anything — Codex, Copilot, a cloud agent, the web editor, a human —
 * becomes a cross-machine conflict target even though no Claude Code hook ran.
 *
 * Replaces the retired Actions workflow (auto-register.yml → branch_registry, which
 * nothing read): the push already reaches git-watch through the GitHub webhook, so this
 * costs no Actions minutes and writes the table `conflicts` actually reads.
 *
 * Rows live under one virtual machine (`github-push`). They are shadowed — dropped on
 * read — whenever a real machine has the same branch, so a branch registered by the
 * machine that pushed it never shows twice or conflicts with itself (see dropShadowedPushRows).
 */
import { basename, dirname } from 'path';
import { execFileSync } from 'child_process';
import type { MachineIdentity } from '../types/cloud.js';
import type { MachineRegistryView } from '../types/cloud.js';

export const PUSH_MACHINE: MachineIdentity = { id: 'github-push', name: 'github', hostname: 'github.com' };

const NULL_SHA = '0000000000000000000000000000000000000000';
const SHA_RE = /^[0-9a-f]{40}$/i;

export interface PushEventLike {
    event_type: string;
    ref: string | null;
    branch: string | null;
    after_sha: string | null;
    sender_login: string | null;
}

/** The branch a push should register, or null (not a push, a delete, a tag, or trunk). */
export function branchToRegister(event: PushEventLike, defaultBranch: string): string | null {
    if (event.event_type !== 'push') return null;
    if (!event.after_sha || event.after_sha === NULL_SHA || !SHA_RE.test(event.after_sha)) return null;
    if (!event.ref?.startsWith('refs/heads/')) return null;
    const branch = event.ref.slice('refs/heads/'.length);
    if (!branch || branch === defaultBranch) return null;
    return branch;
}

/** Agent from the branch prefix (`spider3/topic` → spider3), else the GitHub sender. */
export function agentFor(branch: string, sender: string | null): string {
    return branch.includes('/') ? branch.split('/')[0] : (sender || 'github');
}

/**
 * Credentials for the write. ONLY the SPIDERSAN_-prefixed names: git-watch's own
 * SUPABASE_URL/KEY is the anon key for reading events, and RLS refuses a registry write
 * with it — falling back to it would fail on every push instead of skipping cleanly.
 */
export function pushRegistryCreds(env: NodeJS.ProcessEnv = process.env): { url: string; key: string } | null {
    const url = env.SPIDERSAN_SUPABASE_URL;
    const key = env.SPIDERSAN_SUPABASE_KEY;
    return url && key ? { url, key } : null;
}

/**
 * Same value registry-sync stamps (`getRepoName()` = clone dir basename), or reads
 * return nothing. Resolved through --git-common-dir so a sibling worktree
 * (`spidersan-topic`) still names the main clone (`spidersan`).
 */
export function repoNameFor(localPath: string): string {
    try {
        const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
            { cwd: localPath, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 }).trim();
        return basename(dirname(common));
    } catch {
        return basename(localPath);
    }
}

type Fetch = typeof fetch;

async function supabase(creds: { url: string; key: string }, path: string, init: RequestInit, fetchFn: Fetch): Promise<Response> {
    return fetchFn(`${creds.url}/rest/v1/${path}`, {
        signal: AbortSignal.timeout(10_000),
        ...init,
        headers: {
            apikey: creds.key,
            Authorization: `Bearer ${creds.key}`,
            'Content-Type': 'application/json',
            ...(init.headers ?? {}),
        },
    });
}

/**
 * Upsert ONE row. Deliberately not SupabaseRegistrySyncClient.push(): that treats its
 * branch list as the machine's complete set and abandons every other row, which here
 * would abandon all other pushed branches in the repo.
 */
export async function upsertPushRow(
    creds: { url: string; key: string },
    row: { repoName: string; repoPath: string; branch: string; files: string[]; agent: string; projectId?: string },
    fetchFn: Fetch = fetch,
): Promise<boolean> {
    const res = await supabase(creds, 'spider_registries?on_conflict=machine_id,repo_name,branch_name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([{
            machine_id: PUSH_MACHINE.id,
            machine_name: PUSH_MACHINE.name,
            hostname: PUSH_MACHINE.hostname,
            repo_name: row.repoName,
            repo_path: row.repoPath,
            branch_name: row.branch,
            status: 'active',
            files: row.files,
            agent: row.agent,
            description: 'registered from a push (git-watch)',
            synced_at: new Date().toISOString(),
            project_id: row.projectId ?? 'default',
        }]),
    }, fetchFn);
    return res.ok;
}

/** Mark the pushed-branch row abandoned (branch deleted on GitHub). */
export async function abandonPushRow(
    creds: { url: string; key: string },
    repoName: string,
    branch: string,
    fetchFn: Fetch = fetch,
): Promise<boolean> {
    const res = await supabase(creds,
        `spider_registries?machine_id=eq.${encodeURIComponent(PUSH_MACHINE.id)}` +
        `&repo_name=eq.${encodeURIComponent(repoName)}&branch_name=eq.${encodeURIComponent(branch)}`,
        { method: 'PATCH', body: JSON.stringify({ status: 'abandoned', synced_at: new Date().toISOString() }) },
        fetchFn);
    return res.ok;
}

const defaultBranchCache = new Map<string, string>();

function ghHeaders(token?: string): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'spidersan-git-watch' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
}

/** The repo's default branch (cached per process). Null if GitHub can't say — then don't register. */
export async function defaultBranchOf(repo: string, token?: string, fetchFn: Fetch = fetch): Promise<string | null> {
    const key = repo.toLowerCase();
    const hit = defaultBranchCache.get(key);
    if (hit) return hit;
    try {
        const res = await fetchFn(`https://api.github.com/repos/${repo}`, { headers: ghHeaders(token), signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const name = ((await res.json()) as { default_branch?: string }).default_branch;
        if (!name) return null;
        defaultBranchCache.set(key, name);
        return name;
    } catch {
        return null;
    }
}

/**
 * Files the branch changes against trunk, via GitHub's compare API: the local clone
 * usually lacks commits pushed from elsewhere, and a new branch has no `before` sha.
 * ponytail: compare caps at 300 files; a bigger branch registers its first 300.
 */
export async function filesVsTrunk(repo: string, base: string, head: string, token?: string, fetchFn: Fetch = fetch): Promise<string[] | null> {
    try {
        const res = await fetchFn(
            `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(base)}...${head}`,
            { headers: ghHeaders(token), signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const data = await res.json() as { files?: Array<{ filename: string }> };
        return (data.files ?? []).map(f => f.filename);
    } catch {
        return null;
    }
}

/**
 * Drop pushed-branch rows a real registration already covers. Applied on every read
 * (pull) BEFORE the caller's own machine is excluded, so a branch the caller itself
 * registered doesn't come back as "github/<branch>" and conflict with itself.
 * `ownBranches` covers the race where the webhook beats the pusher's own registry-sync.
 */
export function dropShadowedPushRows(views: MachineRegistryView[], ownBranches: Iterable<string> = []): MachineRegistryView[] {
    const covered = new Set<string>(ownBranches);
    for (const v of views) {
        if (v.machine_id === PUSH_MACHINE.id) continue;
        for (const b of v.branches) if (b.status === 'active') covered.add(b.name);
    }
    return views
        .map(v => v.machine_id !== PUSH_MACHINE.id ? v : { ...v, branches: v.branches.filter(b => !covered.has(b.name)) })
        .filter(v => v.machine_id !== PUSH_MACHINE.id || v.branches.length > 0);
}
