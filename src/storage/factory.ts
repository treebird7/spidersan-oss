/**
 * Storage factory - selects the right storage backend
 */

import { LocalStorage } from './local.js';
import { SupabaseStorage } from './supabase.js';
import type { StorageAdapter } from './adapter.js';
import { resolveSupabaseCredentials } from '../lib/supabase-credentials.js';

export async function getStorage(): Promise<StorageAdapter> {
    const supabaseConfig = await resolveSupabaseCredentials();

    if (supabaseConfig) {
        return new SupabaseStorage(supabaseConfig);
    }

    return new LocalStorage();
}
