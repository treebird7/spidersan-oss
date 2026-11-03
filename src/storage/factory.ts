/**
 * Storage factory.
 *
 * The branch registry is always the local JSON store. Cross-machine sync is a
 * separate concern, resolved by resolveRegistrySync() from storage.syncModule.
 */

import { LocalStorage } from './local.js';
import type { StorageAdapter } from './adapter.js';

export async function getStorage(): Promise<StorageAdapter> {
    return new LocalStorage();
}
