/**
 * git-events-subscriber
 *
 * Subscribes to spidersan_git_events via Supabase Realtime for low-latency
 * git-change notifications, with a catch-up poll on startup/reconnect so no
 * events are missed while a machine was offline.
 *
 * Delivery model:
 *   Realtime INSERT  — instant fan-out (< 1s when connected)
 *   Catch-up query   — WHERE seq > last_seen_seq on startup/reconnect
 *
 * Actions per event type (P1 — notify, not auto-execute):
 *   push          → warn agent, log to activity + pending files
 *   pull_request  → log only
 *   create        → log only
 *   delete        → mark registry branch abandoned, archive entry
 *
 * AI layer (P2): pending events will be routed through spidersan-smol/gemma4
 * for ecosystem-aware severity decisions. The pending log is the handoff point.
 */

import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, statSync, renameSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { getStorage } from '../storage/index.js';
import { handleEvent } from './ai/event-handler.js';
import type { EventPayload } from './ai/types.js';
import { logActivity } from './activity.js';

const execFileAsync = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitEvent {
    id:           string;
    seq:          number;
    delivery_id:  string;
    repo:         string;         // "owner/repo"
    event_type:   string;         // push | pull_request | create | delete
    action:       string | null;
    ref:          string | null;
    ref_type:     string | null;
    branch:       string | null;
    before_sha:   string | null;
    after_sha:    string | null;
    sender_login: string | null;
    received_at:  string;
}

export interface GitWatchOptions {
    pollIntervalMs?: number;
    repoPaths?: string[];         // explicit repo paths; if empty, auto-detect
    onEvent?: (event: GitEvent) => void;
    logger?: (msg: string) => void;
    quiet?: boolean;
    disableRealtime?: boolean;   // opt-out of WebSocket subscription (polling only)
}

export interface GitWatchHandle {
    stop: () => void;
}

// ─── Paths ────────────────────────────────────────────────────────────────────

const SPIDERSAN_DIR     = join(homedir(), '.spidersan');
const CURSOR_FILE       = join(SPIDERSAN_DIR, 'git-watch-cursor.json');
const ACTIVITY_LOG      = join(SPIDERSAN_DIR, 'activity.jsonl');
const PENDING_LOG       = join(SPIDERSAN_DIR, 'git-events-pending.jsonl');
const PENDING_CONSUMED_LOG = join(SPIDERSAN_DIR, 'git-events-consumed.jsonl');
const PENDING_TEMP      = join(SPIDERSAN_DIR, 'git-events-pending.jsonl.tmp');
const ARCHIVE_LOG       = join(SPIDERSAN_DIR, 'archive.jsonl');

// ─── Cursor persistence ───────────────────────────────────────────────────────

function readCursor(): number {
    try {
        if (!existsSync(CURSOR_FILE)) return 0;
        const data = JSON.parse(readFileSync(CURSOR_FILE, 'utf8'));
        return typeof data.seq === 'number' ? data.seq : 0;
    } catch {
        return 0;
    }
}

function writeCursor(seq: number): void {
    try {
        writeFileSync(CURSOR_FILE, JSON.stringify({ seq, updated_at: new Date().toISOString() }));
    } catch {
        // non-fatal
    }
}

// ─── Activity / pending logging ───────────────────────────────────────────────

function appendLog(file: string, entry: Record<string, unknown>): void {
    try {
        appendFileSync(file, JSON.stringify(entry) + '\n');
    } catch {
        // non-fatal
    }
}

// ─── Remote URL → local path cache ───────────────────────────────────────────

/**
 * Build a map from "owner/repo" to local clone path(s).
 * Scans provided repoPaths first; if empty, scans all registered repos
 * by reading their .spidersan/registry.json locations from ~/.spidersan.
 */
function normalizeRemoteUrl(url: string): string {
    // Normalize ssh and https to "owner/repo"
    // git@github.com:treebird7/Envoak.git  →  treebird7/Envoak
    // https://github.com/treebird7/Envoak.git  →  treebird7/Envoak
    return url
        .replace(/^git@github\.com:/, '')
        .replace(/^https?:\/\/github\.com\//, '')
        .replace(/\.git$/, '');
}

function getRemoteForPath(repoPath: string): string | null {
    try {
        const url = execFileSync('git', ['remote', 'get-url', 'origin'], {
            cwd: repoPath,
            encoding: 'utf-8',
            timeout: 5000,
        }).trim();
        return normalizeRemoteUrl(url);
    } catch {
        return null;
    }
}

function buildRepoMap(explicitPaths: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>(); // owner/repo → [localPath, ...]

    const pathsToScan: string[] = explicitPaths.length > 0
        ? explicitPaths
        : discoverRegisteredRepoPaths();

    for (const p of pathsToScan) {
        const absPath = resolve(p);
        const remote = getRemoteForPath(absPath);
        if (!remote) continue;
        const existing = map.get(remote) ?? [];
        existing.push(absPath);
        map.set(remote, existing);
    }

    return map;
}

/**
 * Discover repo paths from all .spidersan registries visible from ~/.spidersan.
 * Falls back to scanning ~/Dev/* for .spidersan directories.
 */
function discoverRegisteredRepoPaths(): string[] {
    const devDir = join(homedir(), 'Dev');
    const paths: string[] = [];
    try {
        const entries = readdirSync(devDir);
        for (const entry of entries) {
            const full = join(devDir, entry);
            try {
                if (statSync(full).isDirectory() && existsSync(join(full, '.spidersan', 'registry.json'))) {
                    paths.push(full);
                }
            } catch {
                // skip
            }
        }
    } catch {
        // devDir doesn't exist or can't be read
    }
    return paths;
}

// ─── Per-repo worker queue ────────────────────────────────────────────────────

const queues = new Map<string, Promise<void>>(); // repoPath → last task

function enqueue(repoPath: string, task: () => Promise<void>): void {
    const last = queues.get(repoPath) ?? Promise.resolve();
    const next = last.then(task).catch(() => undefined);
    queues.set(repoPath, next);
}

// ─── Tree-pair detection ──────────────────────────────────────────────────────

const TREE_PAIR_RE = /^(sql-tree|ts-tree)\/pairs\/[^/]+\.json$/;

const TREE_ACTION_HINTS: Record<string, string> = {
    'sql-tree': 'mycsan /sql-review validate',
    'ts-tree':  'ts-review validate',
};

/**
 * When a push lands on treebird7/treebird, compare before..after via GitHub API
 * and detect newly added gold-pair JSON files. Emits a targeted pending entry
 * per tree so the validation cue is specific and actionable.
 */
async function detectTreePairs(event: GitEvent, log: (m: string) => void): Promise<void> {
    if (!event.before_sha || !event.after_sha) return;
    const url = `https://api.github.com/repos/${event.repo}/compare/${event.before_sha}...${event.after_sha}`;
    const githubToken = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
        'Accept':     'application/vnd.github.v3+json',
        'User-Agent': 'spidersan-git-watch',
    };
    if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;
    try {
        const res = await fetch(url, { headers });
        if (!res.ok) return;

        const data = await res.json() as { files?: Array<{ filename: string; status: string }> };
        const newPairs = (data.files ?? []).filter(f => f.status === 'added' && TREE_PAIR_RE.test(f.filename));
        if (!newPairs.length) return;

        // Group by tree (sql-tree / ts-tree)
        const grouped: Record<string, string[]> = {};
        for (const f of newPairs) {
            const tree = f.filename.split('/')[0];
            (grouped[tree] ??= []).push(f.filename);
        }

        for (const [tree, files] of Object.entries(grouped)) {
            const hint = TREE_ACTION_HINTS[tree] ?? `review ${tree}/pairs/`;
            log(`🌱  ${files.length} new pair(s) in ${tree} — validate: \`${hint}\``);
            appendLog(PENDING_LOG, {
                type:         'tree_pairs_ready',
                tree,
                files,
                count:        files.length,
                repo:         event.repo,
                branch:       event.branch,
                after_sha:    event.after_sha?.slice(0, 7),
                received_at:  event.received_at,
                ts:           new Date().toISOString(),
                action_hint:  hint,
            });
        }
    } catch {
        // non-fatal — GitHub API might be rate-limited or unreachable
    }
}

// ─── Pending tree-pairs consumer ──────────────────────────────────────────────

/** Deterministic ID for a tree_pairs_ready entry — used for idempotent consumption. */
function makeEntryId(entry: Record<string, unknown>): string {
    const tree  = typeof entry.tree === 'string'     ? entry.tree     : 'unknown';
    const sha   = typeof entry.after_sha === 'string' ? entry.after_sha : 'unknown';
    const repo  = typeof entry.repo === 'string'     ? entry.repo     : 'unknown';
    const files = Array.isArray(entry.files)          ? (entry.files as string[]).join('|') : '';
    return `${repo}:${sha}:${tree}:${files}`;
}

/** Read already-consumed entry IDs from the consumed log. */
function readConsumedIds(): Set<string> {
    try {
        if (!existsSync(PENDING_CONSUMED_LOG)) return new Set();
        const lines = readFileSync(PENDING_CONSUMED_LOG, 'utf8').split('\n').filter(Boolean);
        const ids = new Set<string>();
        for (const line of lines) {
            try {
                const entry = JSON.parse(line) as Record<string, unknown>;
                if (typeof entry._id === 'string') ids.add(entry._id);
            } catch { /* skip malformed */ }
        }
        return ids;
    } catch {
        return new Set();
    }
}

let isConsuming = false; // single-flight guard

/**
 * Read pending.jsonl, emit a hive handoff signal for each unconsumed
 * tree_pairs_ready entry, then atomically rewrite the file without them.
 *
 * Only successfully dispatched entries are removed — on failure the entry
 * stays in pending for the next poll cycle. Uses a deterministic ID so
 * restarts are idempotent.
 */
async function consumePendingTreePairs(log: (m: string) => void): Promise<void> {
    if (isConsuming) return;
    isConsuming = true;
    try {
        if (!existsSync(PENDING_LOG)) return;

        let rawLines: string[];
        try {
            rawLines = readFileSync(PENDING_LOG, 'utf8').split('\n').filter(Boolean);
        } catch {
            return;
        }

        const consumedIds = readConsumedIds();
        const remaining: string[]   = []; // non-tree_pairs_ready lines → kept
        const toConsume: Array<{ entry: Record<string, unknown>; id: string; raw: string }> = [];

        for (const line of rawLines) {
            try {
                const entry = JSON.parse(line) as Record<string, unknown>;
                if (entry.type === 'tree_pairs_ready') {
                    const id = makeEntryId(entry);
                    if (!consumedIds.has(id)) {
                        toConsume.push({ entry, id, raw: line });
                    }
                    // Already-consumed entries are dropped from pending silently
                } else {
                    remaining.push(line);
                }
            } catch {
                remaining.push(line); // preserve malformed lines verbatim
            }
        }

        if (toConsume.length === 0) return;

        log(`🔁 consuming ${toConsume.length} pending tree_pairs_ready event(s)`);

        const succeeded: Array<{ entry: Record<string, unknown>; id: string }> = [];
        const failed:    string[] = []; // raw lines to keep in pending

        for (const { entry, id, raw } of toConsume) {
            const task  = typeof entry.action_hint === 'string' ? entry.action_hint : `review ${entry.tree}/pairs/`;
            const files = Array.isArray(entry.files) ? (entry.files as string[]) : [];
            const summary = `spidersan auto-dispatch: ${entry.tree} pair(s) ready — ${entry.repo}@${entry.after_sha} — ${task}`;

            const args = [
                'hive', 'signal',
                '--status',  'awaiting-review',
                '--task',    task,
                '--handoff', 'review',
                '--summary', summary,
            ];
            if (files.length > 0) args.push('--files', files.join(','));

            log(`📡 hive handoff → ${task} (${files.length} file(s))`);
            try {
                await execFileAsync('envoak', args, { timeout: 15000 });
                succeeded.push({ entry, id });
                log(`✅ dispatched ${id}`);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`⚠  hive signal failed for ${id}: ${msg} — retaining in pending`);
                failed.push(raw);
            }
        }

        if (succeeded.length === 0) return;

        // Record successful dispatches in consumed log
        for (const { entry, id } of succeeded) {
            appendLog(PENDING_CONSUMED_LOG, { ...entry, _id: id, consumed_at: new Date().toISOString() });
        }

        // Atomic rewrite: remaining non-consumed lines + any failed tree_pairs lines
        const finalLines = [...remaining, ...failed];
        try {
            writeFileSync(PENDING_TEMP, finalLines.length > 0 ? finalLines.join('\n') + '\n' : '');
            renameSync(PENDING_TEMP, PENDING_LOG);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log(`⚠  failed to rewrite pending log: ${msg}`);
        }
    } finally {
        isConsuming = false;
    }
}

const NULL_SHA = '0000000000000000000000000000000000000000';

const SHA_RE = /^[0-9a-f]{7,40}$/i;

async function enrichFilesFromGit(repoPath: string, beforeSha: string | null, afterSha: string | null): Promise<string[]> {
    if (!beforeSha || !afterSha || beforeSha === NULL_SHA) return [];
    if (!SHA_RE.test(beforeSha) || !SHA_RE.test(afterSha)) return [];
    try {
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', `${beforeSha}...${afterSha}`], {
            cwd: repoPath,
            timeout: 10000,
        });
        return stdout.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handlePush(event: GitEvent, localPaths: string[], log: (m: string) => void): Promise<void> {
    const shortSha = event.after_sha?.slice(0, 7) ?? 'unknown';
    const who = event.sender_login ?? 'unknown';
    const branch = event.branch ?? event.ref ?? 'unknown';

    log(`⚠  git push: ${event.repo} ${branch} by ${who} (${shortSha}) — run \`spidersan pulse\` to check conflicts`);

    // Notify fleet when main is updated — all machines see this in hive status / pulse
    const isDefaultBranch = branch === 'main' || branch === 'master';
    if (isDefaultBranch) {
        const commitCount = (event as any).commits?.length ?? 1;
        const summary = `${commitCount} commit${commitCount !== 1 ? 's' : ''} pushed to ${event.repo}/${branch} by ${who} (${shortSha})`;
        execFile('envoak', [
            'hive', 'signal',
            '--status', 'idle',
            '--task', `main updated: ${event.repo}`,
            '--summary', summary,
        ], { timeout: 10000 }, () => { /* best-effort, non-blocking */ });
        log(`📡 hive signal emitted: ${summary}`);
    }

    const entry = {
        type: 'git_push',
        repo: event.repo,
        branch,
        sender: who,
        after_sha: shortSha,
        received_at: event.received_at,
        ts: new Date().toISOString(),
        action_hint: 'spidersan pulse',
    };
    appendLog(ACTIVITY_LOG, { ...entry, source: 'git-watch' });
    appendLog(PENDING_LOG, entry);

    // Detect newly committed gold pairs in sql-tree / ts-tree
    if (event.repo === 'treebird7/treebird') {
        await detectTreePairs(event, log);
    }

    // Phase C: AI advice — computed once per event (not per local path)
    const aiRepoPath = localPaths[0];
    const files = aiRepoPath
        ? await enrichFilesFromGit(aiRepoPath, event.before_sha, event.after_sha)
        : [];

    const payload: EventPayload = {
        type: 'push',
        repo: event.repo,
        branch,
        files,
        metadata: { after_sha: event.after_sha, sender: who },
    };

    try {
        const advice = await handleEvent(payload, { repoRoot: aiRepoPath, localOnly: true });
        if (advice.tier >= 2) {
            logActivity({
                repo: event.repo,
                branch,
                agent: who !== 'unknown' ? who : undefined,
                event: 'conflict_detected',
                details: {
                    source: 'git-watch-ai',
                    tier: advice.tier,
                    action: advice.action,
                    message: advice.message,
                    commands: advice.commands,
                    after_sha: event.after_sha,
                    files_checked: files.length,
                },
            });
            log(`🕷  AI [T${advice.tier}/${advice.action}] ${event.repo}/${branch}: ${advice.message.slice(0, 120)}`);
            // Best-effort hive signal — async, non-blocking
            execFile('envoak', [
                'hive', 'signal',
                '--status', 'needs-context',
                '--task', `TIER ${advice.tier} conflict: ${event.repo}/${branch} — ${advice.message.slice(0, 120)}`,
            ], { timeout: 10000 }, () => { /* ignore result */ });
        }
    } catch {
        // AI layer failure is non-fatal — daemon continues
    }

    // Phase C2: auto-pull on main/master pushes when working tree is clean
    if (isDefaultBranch) {
        for (const p of localPaths) {
            enqueue(p, async () => {
                try {
                    // Skip if working tree is dirty
                    const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd: p });
                    if (status.trim()) {
                        log(`⏭  auto-pull skipped (dirty tree): ${p}`);
                        return;
                    }
                    // Skip if current branch is not main/master
                    const { stdout: currentBranch } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: p });
                    if (currentBranch.trim() !== branch) {
                        log(`⏭  auto-pull skipped (on branch ${currentBranch.trim()}): ${p}`);
                        return;
                    }
                    await execFileAsync('git', ['fetch', 'origin'], { cwd: p });
                    const { stdout: merged } = await execFileAsync('git', ['merge', '--ff-only', `origin/${branch}`], { cwd: p });
                    log(`⬇  auto-pulled ${event.repo}/${branch} → ${p}: ${merged.trim().split('\n')[0]}`);
                } catch (err: any) {
                    log(`⚠  auto-pull failed for ${p}: ${err?.message ?? err}`);
                }
            });
        }
    }
}

async function handlePR(event: GitEvent, _localPaths: string[], log: (m: string) => void): Promise<void> {
    const action = event.action ?? 'event';
    const branch = event.branch ?? 'unknown';
    const who = event.sender_login ?? 'unknown';
    log(`ℹ  PR ${action}: ${event.repo} ${branch} by ${who}`);
    appendLog(ACTIVITY_LOG, { type: 'pull_request', action, repo: event.repo, branch, sender: who, received_at: event.received_at, ts: new Date().toISOString(), source: 'git-watch' });

    // Phase C2: AI merge-readiness advice
    const payload: EventPayload = {
        type: 'pull_request',
        repo: event.repo,
        branch,
        metadata: { action, sender: who },
    };
    try {
        const advice = await handleEvent(payload, { localOnly: true });
        if (advice.tier >= 2) {
            logActivity({
                repo: event.repo,
                branch,
                agent: who !== 'unknown' ? who : undefined,
                event: 'conflict_detected',
                details: {
                    source: 'git-watch-ai',
                    trigger: 'pull_request',
                    pr_action: action,
                    tier: advice.tier,
                    action: advice.action,
                    message: advice.message,
                    commands: advice.commands,
                },
            });
            log(`🕷  AI [T${advice.tier}/${advice.action}] PR ${event.repo}/${branch}: ${advice.message.slice(0, 120)}`);
            execFile('envoak', [
                'hive', 'signal',
                '--status', 'needs-context',
                '--task', `TIER ${advice.tier} PR conflict: ${event.repo}/${branch} — ${advice.message.slice(0, 120)}`,
            ], { timeout: 10000 }, () => { /* ignore result */ });
        }
    } catch {
        // AI layer failure is non-fatal
    }
}

async function handleCreate(event: GitEvent, _localPaths: string[], log: (m: string) => void): Promise<void> {
    if (event.ref_type !== 'branch') return;
    const branch = event.branch ?? 'unknown';
    const who = event.sender_login ?? 'unknown';
    log(`ℹ  branch created: ${event.repo}/${branch} by ${who}`);
    appendLog(ACTIVITY_LOG, { type: 'branch_created', repo: event.repo, branch, sender: who, received_at: event.received_at, ts: new Date().toISOString(), source: 'git-watch' });

    // Phase C2: register branch stub so AI conflict detection knows it exists
    // before any files are pushed. Files start empty; enriched on first push.
    try {
        const storage = await getStorage();
        const existing = await storage.get(branch);
        if (!existing) {
            await storage.register({
                name: branch,
                files: [],
                status: 'active',
                agent: who !== 'unknown' ? who : undefined,
                description: `auto-registered by git-watch on remote create (${event.repo})`,
            });
            log(`   registered branch stub: ${branch}`);
            logActivity({
                repo: event.repo,
                branch,
                agent: who !== 'unknown' ? who : undefined,
                event: 'register',
                details: { source: 'git-watch-auto', trigger: 'remote_branch_create' },
            });
        }
    } catch {
        // Storage write is best-effort — log failure is non-fatal
    }
}

async function handleDelete(event: GitEvent, localPaths: string[], log: (m: string) => void): Promise<void> {
    if (event.ref_type !== 'branch') return;
    const branch = event.branch ?? 'unknown';
    const who = event.sender_login ?? 'unknown';
    log(`🗑  branch deleted remotely: ${event.repo}/${branch} by ${who} — archiving in local registries`);

    // Only fire the conflict notification once even if multiple local paths exist
    let notified = false;

    for (const p of localPaths) {
        enqueue(p, async () => {
            try {
                const storage = await getStorage();
                const allBranches = await storage.list();
                const entry = allBranches.find(b => b.name === branch);
                if (!entry) return;

                // Notify if the deleted branch had active file registrations — means
                // conflict detection was tracking it and other branches may share files.
                if (!notified && entry.status === 'active' && entry.files && entry.files.length > 0) {
                    notified = true;
                    log(`⚠  deleted branch ${branch} had ${entry.files.length} registered file(s) — potential conflict impact`);
                    logActivity({
                        repo: event.repo,
                        branch,
                        agent: who !== 'unknown' ? who : undefined,
                        event: 'conflict_detected',
                        details: {
                            trigger: 'branch_deleted_with_active_registrations',
                            files: entry.files,
                            deleted_by: who,
                        },
                    });
                    execFile('envoak', [
                        'hive', 'signal',
                        '--status', 'awaiting-review',
                        '--task', `deleted branch ${branch} had active conflict registrations (${entry.files.length} files) in ${event.repo}`,
                        '--files', entry.files.slice(0, 5).join(','),
                    ], { timeout: 10000 }, () => { /* best-effort */ });
                }

                // Archive first, then remove from active registry
                appendLog(ARCHIVE_LOG, {
                    ...entry,
                    archived_at: new Date().toISOString(),
                    archived_reason: 'remote-delete',
                    archived_by: who,
                    repo_path: p,
                });

                await storage.update(branch, { status: 'abandoned' });
                log(`   archived ${branch} from ${p}`);
            } catch {
                // non-fatal
            }
        });
    }

    appendLog(ACTIVITY_LOG, { type: 'branch_deleted', repo: event.repo, branch, sender: who, received_at: event.received_at, ts: new Date().toISOString(), source: 'git-watch' });
}

async function dispatchEvent(event: GitEvent, repoMap: Map<string, string[]>, opts: GitWatchOptions): Promise<void> {
    const log = opts.logger ?? (opts.quiet ? () => {} : (m: string) => console.log(`[git-watch] ${m}`));
    const localPaths = repoMap.get(event.repo) ?? [];

    opts.onEvent?.(event);

    switch (event.event_type) {
        case 'push':          return handlePush(event, localPaths, log);
        case 'pull_request':  return handlePR(event, localPaths, log);
        case 'create':        return handleCreate(event, localPaths, log);
        case 'delete':        return handleDelete(event, localPaths, log);
    }
}

// ─── Supabase REST client (raw fetch — no @supabase/supabase-js) ──────────────

interface SupabaseConfig {
    url: string;
    key: string;
    jwt?: string;
}

function getConfig(): SupabaseConfig | null {
    const url = process.env.SUPABASE_URL;
    if (!url) return null;

    const jwt = process.env.COLONY_SESSION_JWT;
    const key = process.env.SUPABASE_KEY;
    if (!jwt && !key) return null;

    return { url, key: key ?? '', jwt };
}

async function supabaseFetch(
    cfg: SupabaseConfig,
    path: string,
    params: Record<string, string> = {}
): Promise<GitEvent[] | null> {
    const qs = new URLSearchParams(params).toString();
    const endpoint = `${cfg.url}/rest/v1/${path}${qs ? '?' + qs : ''}`;
    const headers: Record<string, string> = {
        'apikey': cfg.key,
        'Content-Type': 'application/json',
    };
    headers['Authorization'] = cfg.jwt ? `Bearer ${cfg.jwt}` : `Bearer ${cfg.key}`;

    try {
        const res = await fetch(endpoint, { headers });
        if (!res.ok) return null;
        return res.json() as Promise<GitEvent[]>;
    } catch {
        return null;
    }
}

// ─── Catch-up query ───────────────────────────────────────────────────────────

async function catchUp(
    cfg: SupabaseConfig,
    repoMap: Map<string, string[]>,
    opts: GitWatchOptions
): Promise<void> {
    const cursor = readCursor();
    const data = await supabaseFetch(cfg, 'spidersan_git_events', {
        'seq': `gt.${cursor}`,
        'order': 'seq.asc',
        'limit': '200',
        'select': '*',
    });

    if (!data?.length) return;

    for (const row of data) {
        await dispatchEvent(row, repoMap, opts);
    }

    writeCursor(data[data.length - 1].seq);
}

// ─── Supabase Realtime (Phoenix channels over native WebSocket) ───────────────

interface RealtimeHandle {
    stop: () => void;
}

/**
 * Opens a Supabase Realtime WebSocket subscription to spidersan_git_events.
 * Uses Node 24's native globalThis.WebSocket — no extra dependencies.
 * Returns null if WebSocket is unavailable (graceful downgrade to polling).
 */
function startRealtimeSubscription(
    cfg: SupabaseConfig,
    repoMap: Map<string, string[]>,
    opts: GitWatchOptions,
    highWaterMark: { seq: number },
    log: (m: string) => void,
): RealtimeHandle | null {
    // Feature-detect native WebSocket (Node 21.3+)
    const WS = (globalThis as Record<string, unknown>).WebSocket as
        (new (url: string) => WebSocket) | undefined;
    if (!WS) return null;

    // Rebind so TypeScript keeps it non-nullable inside nested closures
    const WSClass = WS;

    const project = cfg.url.replace('https://', '').split('.')[0];
    const wsUrl = `wss://${project}.supabase.co/realtime/v1/websocket?apikey=${cfg.key}&vsn=1.0.0`;

    let ws: WebSocket | null = null;
    let stopped = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 1000;
    let refCounter = 1;

    function connect(): void {
        if (stopped) return;
        ws = new WSClass(wsUrl);

        ws.onopen = () => {
            backoffMs = 1000;
            log('realtime: WebSocket active');

            // Join the postgres_changes channel
            ws!.send(JSON.stringify({
                topic: 'realtime:public:spidersan_git_events',
                event: 'phx_join',
                payload: {
                    config: {
                        broadcast: { ack: false },
                        presence: { key: '' },
                        postgres_changes: [
                            { event: 'INSERT', schema: 'public', table: 'spidersan_git_events' },
                        ],
                    },
                    access_token: cfg.jwt ?? cfg.key,
                },
                ref: String(refCounter++),
            }));

            // Heartbeat every 25s
            heartbeatTimer = setInterval(() => {
                if (ws?.readyState === 1 /* OPEN */) {
                    ws.send(JSON.stringify({
                        topic: 'phoenix',
                        event: 'heartbeat',
                        payload: {},
                        ref: String(refCounter++),
                    }));
                }
            }, 25_000);
        };

        ws.onmessage = (ev) => {
            let msg: Record<string, unknown>;
            try { msg = JSON.parse(ev.data as string); } catch { return; }

            // Supabase sends postgres_changes events
            if (msg.event !== 'postgres_changes') return;
            const data = (msg.payload as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
            if (!data || data.type !== 'INSERT') return;

            const record = data.record as GitEvent | undefined;
            if (!record || typeof record.seq !== 'number') return;

            // Dedup with shared high-water mark
            if (record.seq <= highWaterMark.seq) return;
            highWaterMark.seq = record.seq;
            writeCursor(record.seq);

            dispatchEvent(record, repoMap, opts).catch(() => { /* non-fatal */ });
        };

        ws.onerror = () => { /* onclose will handle reconnect */ };

        ws.onclose = () => {
            if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
            if (stopped) return;
            log(`realtime: disconnected — reconnecting in ${backoffMs / 1000}s`);
            reconnectTimer = setTimeout(() => {
                // Catch up on events missed during disconnect, then reconnect
                if (getConfig()) catchUp(cfg, repoMap, opts).catch(() => {}).finally(connect);
            }, backoffMs);
            backoffMs = Math.min(backoffMs * 2, 30_000);
        };
    }

    connect();

    return {
        stop: () => {
            stopped = true;
            if (heartbeatTimer) clearInterval(heartbeatTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            ws?.close();
        },
    };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the git-events daemon in hybrid mode:
 *  - Supabase Realtime WebSocket for < 1s delivery (when available)
 *  - 5-min safety-sweep poll to catch events missed during disconnects
 * Returns a handle with a stop() method.
 */
export async function startGitWatch(opts: GitWatchOptions = {}): Promise<GitWatchHandle> {
    const log = opts.logger ?? (opts.quiet ? () => {} : (m: string) => console.log(`[git-watch] ${m}`));
    // Safety-sweep interval: 5 min when realtime is active, otherwise use configured interval
    const pollMs = opts.pollIntervalMs ?? 60_000;

    const cfg = getConfig();
    if (!cfg) {
        throw new Error(
            'git-watch: SUPABASE_URL and (SUPABASE_KEY or COLONY_SESSION_JWT) are required'
        );
    }

    const repoMap = buildRepoMap(opts.repoPaths ?? []);
    log(`Watching ${repoMap.size} repo(s): ${[...repoMap.keys()].join(', ')}`);

    // Shared high-water mark (monotonic seq dedup between realtime + poll paths)
    const highWaterMark = { seq: readCursor() };

    // Catch-up on startup
    await catchUp(cfg, repoMap, opts);
    await consumePendingTreePairs(log);

    // Start Realtime WebSocket (unless explicitly disabled)
    let realtimeHandle: RealtimeHandle | null = null;
    if (!opts.disableRealtime) {
        realtimeHandle = startRealtimeSubscription(cfg, repoMap, opts, highWaterMark, log);
        if (!realtimeHandle) {
            log('realtime: WebSocket unavailable — polling only');
        }
    }

    // Safety-sweep poll (5 min when realtime active, else use configured interval)
    const sweepMs = realtimeHandle ? Math.max(pollMs, 5 * 60_000) : pollMs;
    const pollTimer = setInterval(async () => {
        await catchUp(cfg, repoMap, opts);
        await consumePendingTreePairs(log);
    }, sweepMs);

    return {
        stop: () => {
            clearInterval(pollTimer);
            realtimeHandle?.stop();
        },
    };
}

/**
 * One-shot catch-up: fetch any missed events since last cursor, then exit.
 * Useful for cron/CI environments that don't run persistent daemons.
 */
export async function catchUpOnce(opts: GitWatchOptions = {}): Promise<void> {
    const cfg = getConfig();
    if (!cfg) throw new Error('git-watch: SUPABASE_URL and (SUPABASE_KEY or COLONY_SESSION_JWT) are required');

    const repoMap = buildRepoMap(opts.repoPaths ?? []);
    const log = opts.logger ?? (opts.quiet ? () => {} : (m: string) => console.log(`[git-watch] ${m}`));
    await catchUp(cfg, repoMap, opts);
    await consumePendingTreePairs(log);
}
