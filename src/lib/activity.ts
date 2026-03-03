import { randomUUID } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir, hostname } from 'os';

export type ActivityEvent =
    | 'register'
    | 'merge'
    | 'abandon'
    | 'conflict_detected'
    | 'sync'
    | 'cleanup'
    | 'ready_check_pass'
    | 'ready_check_fail'
    | 'session_start'
    | 'session_end';

export interface ActivityRecord {
    id: string;
    repo: string;
    branch: string | null;
    agent: string | null;
    machine: string | null;
    event: ActivityEvent;
    details: Record<string, unknown>;
    created_at: string;
}

export interface LogActivityInput {
    repo?: string;
    branch?: string;
    agent?: string;
    machine?: string;
    event: ActivityEvent;
    details?: Record<string, unknown>;
    createdAt?: Date;
}

export interface ActivityQuery {
    branch?: string;
    agent?: string;
    repo?: string;
    since?: Date;
    limit?: number;
}

export interface ActivityQueryResult {
    source: 'supabase' | 'local';
    records: ActivityRecord[];
}

export interface ActivityFlushResult {
    pending: number;
    flushed: number;
    remaining: number;
    source: 'supabase' | 'local';
}

interface FlushState {
    lastFlushedLine: number;
}

interface ActivityRuntime {
    activityFilePath?: string;
    flushStatePath?: string;
    supabaseUrl?: string;
    supabaseKey?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    uuid?: () => string;
    cwd?: string;
}

const DEFAULT_ACTIVITY_DIR = join(homedir(), '.spidersan');
const DEFAULT_ACTIVITY_FILE = join(DEFAULT_ACTIVITY_DIR, 'activity.jsonl');
const DEFAULT_FLUSH_STATE_FILE = join(DEFAULT_ACTIVITY_DIR, 'activity.flush.json');
const DEFAULT_LIMIT = 200;
const SUPABASE_BATCH_SIZE = 100;

function resolveActivityFilePath(runtime: ActivityRuntime = {}): string {
    return runtime.activityFilePath || DEFAULT_ACTIVITY_FILE;
}

function resolveFlushStatePath(runtime: ActivityRuntime = {}): string {
    return runtime.flushStatePath || DEFAULT_FLUSH_STATE_FILE;
}

function ensureParentDir(filePath: string): void {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}

function safeParseJson<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function resolveRepoName(cwd: string): string {
    return basename(cwd);
}

function resolveSupabaseConfig(runtime: ActivityRuntime = {}): { url: string; key: string } | null {
    const url = runtime.supabaseUrl || process.env.SUPABASE_URL;
    const key = runtime.supabaseKey || process.env.SUPABASE_KEY;
    if (!url || !key) return null;
    return { url, key };
}

function normalizeRecord(raw: Partial<ActivityRecord>): ActivityRecord | null {
    if (!raw.id || !raw.repo || !raw.event || !raw.created_at) {
        return null;
    }
    const details = typeof raw.details === 'object' && raw.details !== null
        ? raw.details as Record<string, unknown>
        : {};

    return {
        id: String(raw.id),
        repo: String(raw.repo),
        branch: raw.branch ? String(raw.branch) : null,
        agent: raw.agent ? String(raw.agent) : null,
        machine: raw.machine ? String(raw.machine) : null,
        event: raw.event as ActivityEvent,
        details,
        created_at: String(raw.created_at),
    };
}

function readLocalRecords(runtime: ActivityRuntime = {}): ActivityRecord[] {
    const activityFilePath = resolveActivityFilePath(runtime);
    if (!existsSync(activityFilePath)) return [];

    const content = readFileSync(activityFilePath, 'utf-8');
    const records: ActivityRecord[] = [];
    for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const parsed = safeParseJson<Partial<ActivityRecord>>(line);
        if (!parsed) continue;
        const normalized = normalizeRecord(parsed);
        if (normalized) {
            records.push(normalized);
        }
    }
    return records;
}

function readFlushState(runtime: ActivityRuntime = {}): FlushState {
    const flushStatePath = resolveFlushStatePath(runtime);
    if (!existsSync(flushStatePath)) {
        return { lastFlushedLine: 0 };
    }

    const parsed = safeParseJson<Partial<FlushState>>(readFileSync(flushStatePath, 'utf-8'));
    if (!parsed || typeof parsed.lastFlushedLine !== 'number' || parsed.lastFlushedLine < 0) {
        return { lastFlushedLine: 0 };
    }
    return { lastFlushedLine: parsed.lastFlushedLine };
}

function writeFlushState(state: FlushState, runtime: ActivityRuntime = {}): void {
    const flushStatePath = resolveFlushStatePath(runtime);
    ensureParentDir(flushStatePath);
    writeFileSync(flushStatePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

function buildRecord(input: LogActivityInput, runtime: ActivityRuntime = {}): ActivityRecord {
    const now = (runtime.now || (() => new Date()))();
    const cwd = runtime.cwd || process.cwd();

    return {
        id: (runtime.uuid || randomUUID)(),
        repo: input.repo || resolveRepoName(cwd),
        branch: input.branch || null,
        agent: input.agent || null,
        machine: input.machine || process.env.SPIDERSAN_MACHINE_ID || process.env.HOSTNAME || hostname(),
        event: input.event,
        details: input.details || {},
        created_at: (input.createdAt || now).toISOString(),
    };
}

async function pushToSupabase(records: ActivityRecord[], runtime: ActivityRuntime = {}): Promise<void> {
    if (records.length === 0) return;

    const supabase = resolveSupabaseConfig(runtime);
    if (!supabase) {
        throw new Error('Supabase credentials are not configured');
    }

    const fetchImpl = runtime.fetchImpl || fetch;
    const endpoint = `${supabase.url}/rest/v1/spider_activity_log?on_conflict=id`;
    const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
            'apikey': supabase.key,
            'Authorization': `Bearer ${supabase.key}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify(records),
    });

    if (!response.ok) {
        throw new Error(`Supabase activity write failed (${response.status})`);
    }
}

export function parseSince(input?: string, now: Date = new Date()): Date {
    if (!input) {
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const relative = input.trim().match(/^(\d+)\s*([mhdw])$/i);
    if (relative) {
        const value = parseInt(relative[1], 10);
        const unit = relative[2].toLowerCase();
        const multipliers: Record<string, number> = {
            m: 60 * 1000,
            h: 60 * 60 * 1000,
            d: 24 * 60 * 60 * 1000,
            w: 7 * 24 * 60 * 60 * 1000,
        };
        return new Date(now.getTime() - value * multipliers[unit]);
    }

    const parsed = new Date(input);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed;
    }

    throw new Error(`Invalid --since value "${input}". Use 7d, 24h, 30m, or an ISO date.`);
}

export function logActivity(input: LogActivityInput, runtime: ActivityRuntime = {}): ActivityRecord {
    const record = buildRecord(input, runtime);
    const activityFilePath = resolveActivityFilePath(runtime);

    ensureParentDir(activityFilePath);
    appendFileSync(activityFilePath, JSON.stringify(record) + '\n', 'utf-8');

    void pushToSupabase([record], runtime).catch(() => {
        // Best-effort network write. Local JSONL remains canonical fallback queue.
    });

    return record;
}

export async function flushActivityLog(runtime: ActivityRuntime = {}): Promise<ActivityFlushResult> {
    const allRecords = readLocalRecords(runtime);
    if (allRecords.length === 0) {
        return { pending: 0, flushed: 0, remaining: 0, source: 'local' };
    }

    const state = readFlushState(runtime);
    const start = Math.min(Math.max(state.lastFlushedLine, 0), allRecords.length);
    const pending = allRecords.slice(start);
    if (pending.length === 0) {
        return { pending: 0, flushed: 0, remaining: 0, source: 'supabase' };
    }

    if (!resolveSupabaseConfig(runtime)) {
        return {
            pending: pending.length,
            flushed: 0,
            remaining: pending.length,
            source: 'local',
        };
    }

    let flushed = 0;
    for (let i = 0; i < pending.length; i += SUPABASE_BATCH_SIZE) {
        const batch = pending.slice(i, i + SUPABASE_BATCH_SIZE);
        try {
            await pushToSupabase(batch, runtime);
            flushed += batch.length;
        } catch {
            break;
        }
    }

    if (flushed > 0) {
        writeFlushState({ lastFlushedLine: start + flushed }, runtime);
    }

    return {
        pending: pending.length,
        flushed,
        remaining: pending.length - flushed,
        source: flushed > 0 ? 'supabase' : 'local',
    };
}

function applyLocalFilters(records: ActivityRecord[], query: ActivityQuery): ActivityRecord[] {
    return records
        .filter((record) => {
            if (query.repo && record.repo !== query.repo) return false;
            if (query.branch && record.branch !== query.branch) return false;
            if (query.agent && record.agent !== query.agent) return false;
            if (query.since && new Date(record.created_at).getTime() < query.since.getTime()) return false;
            return true;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, query.limit || DEFAULT_LIMIT);
}

async function querySupabase(query: ActivityQuery, runtime: ActivityRuntime = {}): Promise<ActivityRecord[]> {
    const supabase = resolveSupabaseConfig(runtime);
    if (!supabase) {
        throw new Error('Supabase credentials are not configured');
    }

    const params = new URLSearchParams();
    params.set('select', 'id,repo,branch,agent,machine,event,details,created_at');
    params.set('order', 'created_at.desc');
    params.set('limit', String(query.limit || DEFAULT_LIMIT));

    if (query.repo) params.set('repo', `eq.${query.repo}`);
    if (query.branch) params.set('branch', `eq.${query.branch}`);
    if (query.agent) params.set('agent', `eq.${query.agent}`);
    if (query.since) params.set('created_at', `gte.${query.since.toISOString()}`);

    const fetchImpl = runtime.fetchImpl || fetch;
    const endpoint = `${supabase.url}/rest/v1/spider_activity_log?${params.toString()}`;
    const response = await fetchImpl(endpoint, {
        headers: {
            'apikey': supabase.key,
            'Authorization': `Bearer ${supabase.key}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Supabase query failed (${response.status})`);
    }

    const rows = await response.json() as Array<Partial<ActivityRecord>>;
    const records: ActivityRecord[] = [];
    for (const row of rows) {
        const normalized = normalizeRecord(row);
        if (normalized) {
            records.push(normalized);
        }
    }
    return records;
}

export async function queryActivityLog(query: ActivityQuery, runtime: ActivityRuntime = {}): Promise<ActivityQueryResult> {
    try {
        const supabaseRecords = await querySupabase(query, runtime);
        return { source: 'supabase', records: supabaseRecords };
    } catch {
        const localRecords = applyLocalFilters(readLocalRecords(runtime), query);
        return { source: 'local', records: localRecords };
    }
}
