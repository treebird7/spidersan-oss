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
    const supabaseUrl = process.env.SUPABASE_URL || config.storage.supabaseUrl;
    const supabaseKey = process.env.SUPABASE_KEY || config.storage.supabaseKey;

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
