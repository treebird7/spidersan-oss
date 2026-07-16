/**
 * Single source of truth for resolving spidersan's Supabase credentials.
 *
 * Precedence: SPIDERSAN_SUPABASE_* → SUPABASE_* → config.storage.*
 *
 * SPIDERSAN_SUPABASE_* MUST come first. envoak's vault-inject guard drops any
 * secret whose name carries a bare SUPABASE_ prefix, so vault-injected creds
 * only ever arrive under the scoped names. Resolvers checking just the bare
 * names silently no-op under `envoak vault inject` — the production hook path —
 * and report "Supabase not configured" while a valid grant is present (fc8cf22,
 * 29aa575, tb-efmm; tb-ly0b found 7 more copies with the same defect).
 *
 * This module exists so that stays fixed in ONE place. Do not re-derive these
 * env names inline; call resolveSupabaseCredentials()/resolveSupabaseEnv().
 *
 * COLONY_SUPABASE_* is deliberately absent from the chain: colony points at a
 * different Supabase project, so falling back to it would silently write
 * spider_registries into the wrong database (tb-ly0b).
 */

import { loadConfig } from './config.js';

export interface SupabaseCredentials {
    url: string;
    key: string;
}

/**
 * Env-only resolution. For callers with no config file in scope (subscribers,
 * activity logging) that need a synchronous answer.
 */
export function resolveSupabaseEnv(): { url?: string; key?: string } {
    return {
        url: process.env.SPIDERSAN_SUPABASE_URL || process.env.SUPABASE_URL,
        key: process.env.SPIDERSAN_SUPABASE_KEY || process.env.SUPABASE_KEY,
    };
}

/**
 * Env → config.storage. The default for commands; null when unconfigured.
 */
export async function resolveSupabaseCredentials(
    basePath?: string,
): Promise<SupabaseCredentials | null> {
    const env = resolveSupabaseEnv();
    const config = await loadConfig(basePath);
    const url = env.url || config.storage.supabaseUrl;
    const key = env.key || config.storage.supabaseKey;

    if (!url || !key) return null;
    return { url, key };
}
