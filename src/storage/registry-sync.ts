/**
 * Which cross-machine registry backend to use.
 *
 * Cross-machine sync is pluggable only: a deployment supplies its own
 * SupabaseRegistrySyncClient as an ES module that exports
 * `createRegistrySyncClient()` (sync or async), named by SPIDERSAN_SYNC_MODULE or
 * `storage.syncModule` in the USER's ~/.spidersanrc. A repo-local .spidersanrc is
 * never consulted for this: it would let any cloned repo run code on
 * `spidersan conflicts`.
 *
 * There is no built-in client any more. The hosted registry tables it talked to
 * are being dropped, so without a module there is no cross-machine sync, and
 * callers say so with syncModuleRequiredMessage() rather than reporting "no
 * conflicts" or failing on a missing table.
 */

import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfigWithSources } from '../lib/config.js';
import { resolveSupabaseEnv } from '../lib/supabase-credentials.js';
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

/** The configured sync client, or null when no storage.syncModule is set. */
export async function resolveRegistrySync(): Promise<SupabaseStorage | null> {
    const mod = await syncModulePath();
    if (!mod) return null;
    const m = await import(pathToFileURL(mod).href) as { createRegistrySyncClient?: () => SupabaseRegistrySyncClient | Promise<SupabaseRegistrySyncClient> };
    if (typeof m.createRegistrySyncClient !== 'function') {
        throw new Error(`${mod} does not export createRegistrySyncClient()`);
    }
    return new SupabaseStorage(await m.createRegistrySyncClient());
}

/**
 * The one message for "cross-machine sync asked for, no module configured".
 * Mentions the legacy credentials when they are still set: someone upgrading
 * with SUPABASE_* in their environment would otherwise assume sync still works.
 */
export function syncModuleRequiredMessage(): string[] {
    const lines = [
        'Cross-machine sync needs a sync module (storage.syncModule); none is configured.',
        '  Set it in ~/.spidersanrc (absolute path or ~/...):  { "storage": { "syncModule": "~/path/to/client.mjs" } }',
        '  or export SPIDERSAN_SYNC_MODULE=/path/to/client.mjs',
        '  The module must export createRegistrySyncClient().',
    ];
    const env = resolveSupabaseEnv();
    if (env.url || env.key) {
        lines.push('  Note: the built-in hosted sync client was removed; SPIDERSAN_SUPABASE_* / SUPABASE_* no longer enable sync.');
    }
    return lines;
}
