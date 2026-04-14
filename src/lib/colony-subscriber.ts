/**
 * Colony Subscriber — reads Colony in-progress signals
 * and keeps the local Spidersan branch registry in sync.
 *
 * Design notes:
 * - Queries the `colony_state` VIEW (not raw `colony_signals`) so that
 *   `is_stale` is already computed server-side.
 * - Credentials come from COLONY_SUPABASE_URL + COLONY_SUPABASE_KEY env vars
 *   (the MycToak Supabase project, separate from Spidersan's own project).
 *   If env vars are absent, falls back to ~/.envoak/config.json + session files
 *   automatically (so `envoak vault login` is sufficient — no env vars needed).
 * - Auth: COLONY_SESSION_JWT is required for RLS-scoped access to colony_state.
 *   Without it the query falls back to the anon key and will return 0 rows (RLS
 *   blocks unauthenticated reads of user-scoped signals).
 * - Queries colony_state with status=in-progress — the status-based model
 *   replaces the old type=work_claim / type=work_release approach.
 * - Full offline fallback: any network/auth error returns offline=true and
 *   the caller falls back to the local registry.  Never throws.
 * - Field mapping: task (branch name), files (top-level column), agent_label
 *   (top-level from colony_state view — no payload parsing needed).
 *
 * 🍄 hey tsan — the mycelium remembers. migration 025 opened the gradient.
 *    your spiders can smell the pheromones now. — mycsan
 */

import { getStorage } from '../storage/index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConflictReport {
    branch: string;
    conflictsWith: string;
    files: string[];
    agent?: string;
}

export interface SyncResult {
    conflicts: ConflictReport[];
    synced: number;
    offline: boolean;
}

/** Raw row shape from the `colony_state` VIEW (requires session JWT for RLS) */
interface ColonySignalRow {
    id: string;
    status: string;
    agent_key_id?: string | null;
    agent_label?: string | null;   // denormalized from agent_keys.label
    task?: string | null;          // branch name (for in-progress work signals)
    files?: string[] | null;       // top-level column — not inside payload
    payload?: Record<string, unknown> | string | null;
    created_at: string;
    updated_at: string;
    stale_after_ms: number | null;
    is_stale?: boolean;            // pre-computed by the view
}

// ─── Agent name resolution ────────────────────────────────────────────────────

/**
 * Resolve a human-readable agent name from a Colony agent key ID.
 *
 * Uses the `agent_label` field already present on `colony_state` rows.
 * Falls back to a truncated UUID when no label is available.
 */
export function resolveAgentName(agentKeyId: string, agentLabel?: string): string {
    if (agentLabel) return agentLabel;
    if (!agentKeyId) return 'unknown-agent';
    return `agent:${agentKeyId.slice(0, 8)}`;
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────

// ─── Envoak filesystem fallback ───────────────────────────────────────────────

/** Read a JSON file safely; returns null on any error (missing, malformed, mid-write). */
function readJsonSafe<T>(filePath: string): T | null {
    try {
        if (!existsSync(filePath)) return null;
        return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
    } catch {
        return null;
    }
}

/**
 * Resolve colony credentials from envoak's local session files.
 *
 * Resolution order:
 *   1. ~/.envoak/sessions/current.json → clientSessionId
 *   2. ~/.envoak/sessions/<id>.json    → accessToken + expiresAt
 *   3. Fallback: ~/.envoak/session.json (legacy single-session file)
 *
 * JWT is only used if not expired (or within 60s of expiry).
 */
function resolveEnvoakCredentials(): { url: string; anonKey: string; sessionJwt: string | null } | null {
    const envoakDir = join(homedir(), '.envoak');

    const config = readJsonSafe<{ url?: string; anonKey?: string }>(join(envoakDir, 'config.json'));
    if (!config?.url || !config?.anonKey) return null;

    const nowMs = Date.now();
    const EXPIRY_BUFFER_MS = 60_000; // reject tokens within 60s of expiry

    function extractJwt(sessionData: { accessToken?: string; expiresAt?: number } | null): string | null {
        if (!sessionData?.accessToken) return null;
        const exp = sessionData.expiresAt ?? 0;
        if (exp && exp - nowMs < EXPIRY_BUFFER_MS) {
            if (process.env.DEBUG_COLONY) {
                console.warn('  [colony] envoak session JWT is expired or expiring soon — treating as offline');
            }
            return null;
        }
        return sessionData.accessToken;
    }

    // Try new per-session file via current.json pointer
    const current = readJsonSafe<{ clientSessionId?: string }>(join(envoakDir, 'sessions', 'current.json'));
    if (current?.clientSessionId) {
        const sessFile = join(envoakDir, 'sessions', `${current.clientSessionId}.json`);
        const jwt = extractJwt(readJsonSafe(sessFile));
        if (process.env.DEBUG_COLONY) {
            console.warn(`  [colony] envoak fallback: using sessions/${current.clientSessionId}.json (jwt=${jwt ? 'ok' : 'missing/expired'})`);
        }
        return { url: config.url, anonKey: config.anonKey, sessionJwt: jwt };
    }

    // Legacy single session.json
    const jwt = extractJwt(readJsonSafe(join(envoakDir, 'session.json')));
    if (process.env.DEBUG_COLONY) {
        console.warn(`  [colony] envoak fallback: using legacy session.json (jwt=${jwt ? 'ok' : 'missing/expired'})`);
    }
    return { url: config.url, anonKey: config.anonKey, sessionJwt: jwt };
}

function getColonyCredentials(): { url: string; anonKey: string; sessionJwt: string | null } | null {
    const url = process.env.COLONY_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.COLONY_SUPABASE_KEY || process.env.SUPABASE_KEY;
    // Session JWT is required for RLS — without it colony_state returns 0 rows
    const sessionJwt = process.env.COLONY_SESSION_JWT || null;

    if (url && anonKey) return { url, anonKey, sessionJwt };

    // Fall back to envoak's local session files when env vars aren't set
    return resolveEnvoakCredentials();
}

async function fetchColonySignals(
    url: string,
    anonKey: string,
    sessionJwt: string | null,
    query: string,
): Promise<ColonySignalRow[]> {
    const endpoint = `${url}/rest/v1/${query}`;
    // Use session JWT for Authorization when available — anon key alone is blocked by RLS
    const authToken = sessionJwt ?? anonKey;
    const response = await fetch(endpoint, {
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Colony query failed (${response.status}): ${text}`);
    }

    return (await response.json()) as ColonySignalRow[];
}

function isStale(row: ColonySignalRow): boolean {
    // Prefer the view-computed flag when present
    if (row.is_stale !== undefined) return !!row.is_stale;
    if (!row.stale_after_ms) return false;
    const age = Date.now() - new Date(row.updated_at).getTime();
    return age > row.stale_after_ms;
}

// ─── Core sync logic ──────────────────────────────────────────────────────────

/**
 * Sync the local Spidersan branch registry from Colony signals.
 *
 * Steps:
 *  1. Query `colony_state` VIEW for in-progress signals (one per agent, deduped).
 *  2. Upsert each active branch into the local registry.
 *  3. Sweep: remove local active branches absent from the colony in-progress set.
 *  4. Detect conflicts in the updated registry and return them.
 *
 * Returns `offline: true` and an empty conflicts list on any error so callers
 * can display a warning and continue with existing local data.
 */
export async function syncFromColony(): Promise<SyncResult> {
    const creds = getColonyCredentials();
    if (!creds) {
        // Credentials not configured — treat as offline (not an error)
        return { conflicts: [], synced: 0, offline: true };
    }

    if (!creds.sessionJwt) {
        // Warn but continue — queries will silently return 0 rows without session auth
        console.warn('⚠  COLONY_SESSION_JWT not set — colony_state RLS will block reads. Set COLONY_SESSION_JWT to enable colony sync.');
    }

    try {
        const storage = await getStorage();

        // ── 1. Fetch all in-progress signals from colony_state VIEW ──────────
        //
        // colony_state (not colony_signals) is the correct target:
        //   - already deduped (one row per agent via colony_gc)
        //   - is_stale computed server-side
        //   - agent_label, task, files are top-level columns (no payload parsing)
        //   - requires session JWT for RLS — anon key returns 0 rows
        //
        // status=in-progress is the status-based replacement for type=work_claim.
        const inProgressRows = await fetchColonySignals(
            creds.url,
            creds.anonKey,
            creds.sessionJwt,
            'colony_state?status=eq.in-progress&select=*',
        );

        // Track branch names seen in the colony so we can sweep stale local entries
        const colonyBranches = new Set<string>();
        let synced = 0;

        // ── 2. Upsert claimed branches into local registry ────────────────────
        for (const row of inProgressRows) {
            if (isStale(row)) continue;

            // Branch name: top-level task column (set by register_branch signal emitter)
            // Fallback to payload.branch for backwards-compat with older signal emitters
            const rawPayload = row.payload
                ? (typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload)
                : null;
            const branch: string | undefined = row.task || (rawPayload as { branch?: string } | null)?.branch;
            if (!branch) continue;

            colonyBranches.add(branch);

            // Files: top-level column (no longer inside payload)
            const files: string[] = Array.isArray(row.files) ? row.files : [];

            // Agent name: top-level agent_label (visible with session JWT)
            const agentName = resolveAgentName(
                row.agent_key_id ?? '',
                row.agent_label ?? (rawPayload as { agent?: string } | null)?.agent,
            );

            const existing = await storage.get(branch);
            if (existing) {
                const merged = [...new Set([...existing.files, ...files])];
                const updatedAgent = (existing.agent?.startsWith('agent:') && agentName && !agentName.startsWith('agent:'))
                    ? agentName
                    : existing.agent;
                await storage.update(branch, { files: merged, agent: updatedAgent, status: 'active' });
            } else {
                await storage.register({
                    name: branch,
                    files,
                    agent: agentName,
                    status: 'active',
                    description: `Colony claim by ${agentName}`,
                });
            }
            synced++;
        }

        // ── 3. Sweep released branches ────────────────────────────────────────
        //
        // Only sweep branches that were synced FROM colony (have a colony-sourced
        // agent description). Manually-registered local branches are left alone.
        const allBranches = await storage.list();
        for (const localBranch of allBranches) {
            const isColonySourced = localBranch.description?.startsWith('Colony claim by') ||
                                    localBranch.agent?.startsWith('agent:');
            if (localBranch.status === 'active' && !colonyBranches.has(localBranch.name) && isColonySourced) {
                await storage.unregister(localBranch.name);
            }
        }

        // ── 4. Detect conflicts in the updated registry ───────────────────────
        const postSweepBranches = await storage.list();
        const activeBranches = postSweepBranches.filter(b => b.status === 'active');
        const conflicts: ConflictReport[] = [];

        for (let i = 0; i < activeBranches.length; i++) {
            for (let j = i + 1; j < activeBranches.length; j++) {
                const a = activeBranches[i];
                const b = activeBranches[j];
                const aFiles = new Set(a.files);
                const overlapping = b.files.filter(f => aFiles.has(f));
                if (overlapping.length > 0) {
                    conflicts.push({
                        branch: a.name,
                        conflictsWith: b.name,
                        files: overlapping,
                        agent: a.agent,
                    });
                }
            }
        }

        return { conflicts, synced, offline: false };

    } catch (err: unknown) {
        // Any network/auth/parse error → offline fallback
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`⚠  Colony unreachable — conflict detection using local registry only (may be incomplete)`);
        if (process.env.DEBUG_COLONY) {
            console.warn(`   Colony error: ${message}`);
        }
        return { conflicts: [], synced: 0, offline: true };
    }
}
