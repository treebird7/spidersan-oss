/**
 * Storage factory - selects the right storage backend
 */

import { LocalStorage } from './local.js';
import { SupabaseStorage } from './supabase.js';
import type { StorageAdapter } from './adapter.js';
import { loadConfig } from '../lib/config.js';

interface ResolvedSupabaseConfig {
    url: string;
    key: string;
}

async function getSupabaseConfig(): Promise<ResolvedSupabaseConfig | null> {
    const config = await loadConfig();
    // SPIDERSAN_SUPABASE_* checked first: envoak's vault-inject guard blocks any
    // bare SUPABASE_-prefixed name regardless of owning service (see envoak
    // src/commands/vault.ts SENSITIVE_PREFIXES), so vault-granted credentials
    // must ride the prefixed name. Bare SUPABASE_URL/KEY stays as a fallback for
    // local dev / manually-exported env.
    const supabaseUrl = process.env.SPIDERSAN_SUPABASE_URL || process.env.SUPABASE_URL || config.storage.supabaseUrl;
    const supabaseKey = process.env.SPIDERSAN_SUPABASE_KEY || process.env.SUPABASE_KEY || config.storage.supabaseKey;

    if (!supabaseUrl || !supabaseKey) {
        return null;
    }

    return {
        url: supabaseUrl,
        key: supabaseKey,
    };
}

export async function getStorage(): Promise<StorageAdapter> {
    const supabaseConfig = await getSupabaseConfig();

    if (supabaseConfig) {
        return new SupabaseStorage(supabaseConfig);
    }

    return new LocalStorage();
}
