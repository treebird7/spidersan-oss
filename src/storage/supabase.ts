/**
 * Registry storage with cross-machine sync.
 *
 * Thin compatibility wrapper over a local JsonBranchRegistryStore plus a
 * SupabaseRegistrySyncClient supplied by a configured storage.syncModule (the
 * interface keeps its historical name; any backend can implement it).
 */

import type { StorageAdapter, Branch } from './adapter.js';
import { JsonBranchRegistryStore } from './json-branch-registry-store.js';
import type { SupabaseRegistrySyncClient } from './supabase-registry-sync-client.js';
import { dropShadowedPushRows } from '../lib/push-registry.js';
import type {
    CrossMachineConflict,
    MachineIdentity,
    MachineRegistryView,
    RegistryStatus,
    RegistrySyncResult,
} from '../types/cloud.js';

export class SupabaseStorage implements StorageAdapter {
    private store: JsonBranchRegistryStore;
    private syncClient: SupabaseRegistrySyncClient;

    /** `syncClient` comes from storage.syncModule; there is no built-in client. */
    constructor(syncClient: SupabaseRegistrySyncClient, basePath: string = process.cwd()) {
        this.store = new JsonBranchRegistryStore(basePath);
        this.syncClient = syncClient;
    }

    async init(): Promise<void> {
        await this.store.init();
    }

    async isInitialized(): Promise<boolean> {
        return this.store.isInitialized();
    }

    async list(): Promise<Branch[]> {
        return this.store.list();
    }

    async register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch> {
        return this.store.register(branch);
    }

    async update(name: string, updates: Partial<Branch>): Promise<Branch | null> {
        return this.store.update(name, updates);
    }

    async unregister(name: string): Promise<boolean> {
        return this.store.unregister(name);
    }

    async get(name: string): Promise<Branch | null> {
        return this.store.get(name);
    }

    async findByFiles(files: string[]): Promise<Branch[]> {
        return this.store.findByFiles(files);
    }

    async cleanup(olderThan: Date, includeActive = false): Promise<string[]> {
        return this.store.cleanup(olderThan, includeActive);
    }

    async pushRegistry(
        machine: MachineIdentity,
        repoName: string,
        repoPath: string,
        branches: Branch[],
    ): Promise<RegistrySyncResult> {
        return this.syncClient.push(machine, repoName, repoPath, branches);
    }

    async pullRegistries(repoName: string | string[], excludeMachine?: string, ownBranches?: Iterable<string>): Promise<MachineRegistryView[]> {
        // De-duplicate BEFORE excluding the caller's machine, whatever the module does:
        // the caller's own rows are what shadow a pushed-branch row for a branch it
        // registered itself. dropShadowedPushRows only filters, so a module that
        // already de-duplicates gets the same answer.
        const own = ownBranches ? [...ownBranches] : [];
        const views = await this.syncClient.pull(repoName, undefined, own);
        return dropShadowedPushRows(views, own).filter((v) => v.machine_id !== excludeMachine);
    }

    async getRegistryStatus(repoName?: string): Promise<RegistryStatus[]> {
        return this.syncClient.getStatus(repoName);
    }

    async detectCrossMachineConflicts(
        repoName: string,
        excludeMachine?: string,
    ): Promise<CrossMachineConflict[]> {
        return this.syncClient.detectCrossMachineConflicts(repoName, excludeMachine);
    }
}
