/**
 * Storage factory - selects the right storage backend
 */

import { LocalStorage } from './local.js';
import { SupabaseStorage } from './supabase.js';
import type { StorageAdapter } from './adapter.js';
import { loadConfig } from '../lib/config.js';

export async function getStorage(): Promise<StorageAdapter> {
    const config = await loadConfig();

    // Check environment variables first
    const supabaseUrl = process.env.SUPABASE_URL || config.storage.supabaseUrl;
    const supabaseKey = process.env.SUPABASE_KEY || config.storage.supabaseKey;

    // Use Supabase if credentials are available
    if (supabaseUrl && supabaseKey) {
        return new SupabaseStorage({
            url: supabaseUrl,
            key: supabaseKey,
        });
    }

    // Default to local storage
    return new LocalStorage();
}
