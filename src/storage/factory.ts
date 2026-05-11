/**
 * Storage factory - selects the right storage backend
 */

import { JsonBranchRegistryStore } from './json-branch-registry-store.js';
import { LocalStorage } from './local.js';
import { SupabaseStorage } from './supabase.js';
import type { StorageAdapter } from './adapter.js';
import type { BranchRegistryStore } from './branch-registry-store.js';
import type { SupabaseRegistrySyncClient } from './supabase-registry-sync-client.js';
import { SupabaseRegistrySyncClientImpl } from './supabase-registry-sync-client-impl.js';
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

export async function getBranchRegistryStore(basePath: string = process.cwd()): Promise<BranchRegistryStore> {
    return new JsonBranchRegistryStore(basePath);
}

export async function getSupabaseRegistrySyncClient(): Promise<SupabaseRegistrySyncClient | null> {
    const config = await getSupabaseConfig();
    if (!config) {
        return null;
    }

    return new SupabaseRegistrySyncClientImpl(config);
}

export async function getStorage(): Promise<StorageAdapter> {
    const supabaseConfig = await getSupabaseConfig();

    if (supabaseConfig) {
        return new SupabaseStorage(supabaseConfig);
    }

    return new LocalStorage();
}
