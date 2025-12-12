/**
 * Storage factory - selects the right storage backend
 * Supports production, staging, and local environments
 */

import { LocalStorage } from './local.js';
import { SupabaseStorage } from './supabase.js';
import type { StorageAdapter } from './adapter.js';
import { loadConfig } from '../lib/config.js';

type Environment = 'production' | 'staging' | 'local';

export async function getStorage(forceEnv?: Environment): Promise<StorageAdapter> {
    const config = await loadConfig();

    // Determine environment (CLI flag > env var > config > default)
    const env = forceEnv
        || (process.env.SPIDERSAN_ENV as Environment)
        || config.storage?.environment as Environment
        || 'production';

    // Force local storage if explicitly requested
    if (env === 'local') {
        return new LocalStorage();
    }

    // Select Supabase credentials based on environment
    let supabaseUrl: string | undefined;
    let supabaseKey: string | undefined;
    let projectId: string | undefined;

    if (env === 'staging') {
        supabaseUrl = process.env.SUPABASE_URL_STAGING || config.storage?.supabaseUrlStaging;
        supabaseKey = process.env.SUPABASE_KEY_STAGING || config.storage?.supabaseKeyStaging;
        projectId = 'staging';
    } else { // production
        supabaseUrl = process.env.SUPABASE_URL_PROD
            || process.env.SUPABASE_URL  // backward compatibility
            || config.storage?.supabaseUrl;
        supabaseKey = process.env.SUPABASE_KEY_PROD
            || process.env.SUPABASE_KEY  // backward compatibility
            || config.storage?.supabaseKey;
        projectId = 'production';
    }

    // Use Supabase if credentials are available
    if (supabaseUrl && supabaseKey) {
        return new SupabaseStorage({
            url: supabaseUrl,
            key: supabaseKey,
            projectId,
        });
    }

    // Fallback to local storage
    return new LocalStorage();
}
