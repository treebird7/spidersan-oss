/**
 * Which cross-machine registry backend to use.
 *
 * A deployment can supply its own SupabaseRegistrySyncClient as an ES module that
 * exports `createRegistrySyncClient()` (sync or async), named by
 * SPIDERSAN_SYNC_MODULE or `storage.syncModule` in the USER's ~/.spidersanrc.
 * A repo-local .spidersanrc is never consulted for this: it would let any cloned
 * repo run code on `spidersan conflicts`. Without a module, the built-in Supabase
 * client is used when credentials resolve; otherwise there is no cross-machine sync.
 */

import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfigWithSources } from '../lib/config.js';
import { resolveSupabaseCredentials } from '../lib/supabase-credentials.js';
import { SupabaseStorage } from './supabase.js';
import type { SupabaseRegistrySyncClient } from './supabase-registry-sync-client.js';

export async function syncModulePath(): Promise<string | undefined> {
    let p = process.env.SPIDERSAN_SYNC_MODULE;
    if (!p) {
        // home dir only: includeGlobal=false with basePath=home reads just ~/.spidersanrc*
        const { config } = await loadConfigWithSources(homedir(), { includeGlobal: false });
        p = (config.storage as { syncModule?: string }).syncModule;
    }
    if (!p) return undefined;
    if (p.startsWith('~/')) p = join(homedir(), p.slice(2));
    if (!isAbsolute(p)) throw new Error(`storage.syncModule must be an absolute path (or ~/...), got ${p}`);
    return p;
}

export async function resolveRegistrySync(): Promise<SupabaseStorage | null> {
    const mod = await syncModulePath();
    if (mod) {
        const m = await import(pathToFileURL(mod).href) as { createRegistrySyncClient?: () => SupabaseRegistrySyncClient | Promise<SupabaseRegistrySyncClient> };
        if (typeof m.createRegistrySyncClient !== 'function') {
            throw new Error(`${mod} does not export createRegistrySyncClient()`);
        }
        return new SupabaseStorage(await m.createRegistrySyncClient());
    }
    const creds = await resolveSupabaseCredentials();
    return creds ? new SupabaseStorage(creds) : null;
}
