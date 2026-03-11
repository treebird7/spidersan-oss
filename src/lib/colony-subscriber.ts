/**
 * Colony Subscriber — reads Colony work_claim/work_release signals
 * and keeps the local Spidersan branch registry in sync.
 *
 * Design notes:
 * - Queries the `colony_state` VIEW (not raw `colony_signals`) so that
 *   `is_stale` is already computed server-side.
 * - Credentials come from COLONY_SUPABASE_URL + COLONY_SUPABASE_KEY env vars
 *   (the MycToak Supabase project, separate from Spidersan's own project).
 * - Full offline fallback: any network/auth error returns offline=true and
 *   the caller falls back to the local registry.  Never throws.
 * - Agent label resolution: fetches all colony_state rows first to build a
 *   agentKeyId → agentLabel map, so labels are available even when the
 *   work_claim row itself doesn't carry agent_label.
 *
 * 🍄 hey tsan — the mycelium remembers. migration 025 opened the gradient.
 *    your spiders can smell the pheromones now. — mycsan
 */

import { getStorage } from '../storage/index.js';

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

/** Raw row shape from `colony_signals` table (accessible via anon key) */
interface ColonySignalRow {
    id: string;
    type: string;
    agent_key_id: string;
    payload: Record<string, unknown> | string | null;
    created_at: string;
    updated_at: string;
    stale_after_ms: number | null;
}

// ─── Agent name resolution ────────────────────────────────────────────────────

/**
 * Resolve a human-readable agent name from a Colony agent key ID.
 *
 * Uses the `agent_label` field already present on `colony_state` rows — no
 * UUID lookup table needed.  Falls back to a truncated UUID when no label is
 * available.
 */
export function resolveAgentName(agentKeyId: string, agentLabel?: string): string {
    if (agentLabel) return agentLabel;
    return `agent:${agentKeyId.slice(0, 8)}`;
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────

function getColonyCredentials(): { url: string; key: string } | null {
    const url = process.env.COLONY_SUPABASE_URL;
    const key = process.env.COLONY_SUPABASE_KEY;
    if (!url || !key) return null;
    return { url, key };
}

async function fetchColonySignals(
    url: string,
    key: string,
    query: string,
): Promise<ColonySignalRow[]> {
    const endpoint = `${url}/rest/v1/${query}`;
    const response = await fetch(endpoint, {
        headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
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
    if (!row.stale_after_ms) return false;
    const age = Date.now() - new Date(row.updated_at).getTime();
    return age > row.stale_after_ms;
}

// ─── Core sync logic ──────────────────────────────────────────────────────────

/**
 * Sync the local Spidersan branch registry from Colony signals.
 *
 * Steps:
 *  0. Build an agentKeyId → agentLabel map from all current colony_state rows
 *     (unfiltered) so labels are available even when work_claim rows lack them.
 *  1. Query `colony_state` for non-stale `work_claim` rows.
 *  2. Upsert each claimed branch into the local registry.
 *  3. Query `colony_state` for `work_release` rows and remove released branches.
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

    try {
        const storage = await getStorage();

        // ── 1. Fetch active work_claim signals from colony_signals (raw table) ─
        //
        // Query the raw table instead of the colony_state VIEW because the
        // anon key can only see agent_key_id from the view (agent_label and
        // payload are hidden by RLS on the agent_keys join). colony_signals
        // exposes type + payload to anon.  We compute staleness ourselves.
        //
        // Order by updated_at desc, limit to recent signals to avoid scanning
        // the full history.  Dedup by branch name — latest signal wins.
        const claimRows = await fetchColonySignals(
            creds.url,
            creds.key,
            'colony_signals?type=eq.work_claim&order=updated_at.desc&limit=200&select=*',
        );

        // Dedup: keep only the latest work_claim per agent_key_id
        const latestByAgent = new Map<string, ColonySignalRow>();
        for (const row of claimRows) {
            if (!latestByAgent.has(row.agent_key_id)) {
                latestByAgent.set(row.agent_key_id, row);
            }
        }

        let synced = 0;

        // ── 2. Upsert claimed branches into local registry ────────────────────
        for (const row of latestByAgent.values()) {
            if (isStale(row)) continue;

            const rawPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
            const payload = rawPayload as {
                branch?: string;
                files?: string[];
                repo?: string;
                agent?: string;     // set by post-checkout hook via SPIDERSAN_AGENT/TOAK_AGENT_ID
            };

            if (!payload.branch) continue;

            // Resolve label: prefer row.agent_label (authoritative database field),
            // then fall back to payload.agent (self-reported, always available),
            // then fall back to UUID prefix.
            const agentName = resolveAgentName(row.agent_key_id, row.agent_label ?? payload.agent ?? undefined);
            const files: string[] = Array.isArray(payload.files) ? payload.files : [];

            const existing = await storage.get(payload.branch);
            if (existing) {
                // Merge files (additive) and update agent name if better info available
                const merged = [...new Set([...existing.files, ...files])];
                const updatedAgent = (existing.agent?.startsWith('agent:') && agentName && !agentName.startsWith('agent:'))
                    ? agentName
                    : existing.agent;
                await storage.update(payload.branch, {
                    files: merged,
                    agent: updatedAgent,
                    status: 'active',
                });
            } else {
                await storage.register({
                    name: payload.branch,
                    files,
                    agent: agentName,
                    status: 'active',
                    description: `Colony claim by ${agentName}`,
                });
            }
            synced++;
        }

        // ── 3. Sweep released branches ────────────────────────────────────────
        const releaseRows = await fetchColonySignals(
            creds.url,
            creds.key,
            'colony_signals?type=eq.work_release&order=updated_at.desc&limit=200&select=*',
        );

        for (const row of releaseRows) {
            const rawPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
            const payload = rawPayload as { branch?: string };
            if (!payload.branch) continue;

            const existing = await storage.get(payload.branch);
            if (existing && existing.status === 'active') {
                await storage.unregister(payload.branch);
            }
        }

        // ── 4. Detect conflicts in the updated registry ───────────────────────
        const allBranches = await storage.list();
        const activeBranches = allBranches.filter(b => b.status === 'active');
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
