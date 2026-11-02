/**
 * Supabase environment credentials, for the activity log only.
 *
 * Cross-machine registry sync no longer uses these: it goes through a configured
 * storage.syncModule (see src/storage/registry-sync.ts). This stays because
 * src/lib/activity.ts still uploads the optional activity log with them, and
 * `spidersan config` reports whether they are set.
 *
 * Precedence: SPIDERSAN_SUPABASE_* → SUPABASE_*. The scoped names come first
 * because some secret injectors refuse to pass a bare SUPABASE_* name, and a
 * resolver that checked only the bare names would silently report "not set".
 */

/** Env-only resolution; either field is undefined when unset. */
export function resolveSupabaseEnv(): { url?: string; key?: string } {
    return {
        url: process.env.SPIDERSAN_SUPABASE_URL || process.env.SUPABASE_URL,
        key: process.env.SPIDERSAN_SUPABASE_KEY || process.env.SUPABASE_KEY,
    };
}
