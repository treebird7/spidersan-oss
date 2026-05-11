/**
 * Supabase Storage Adapter
 *
 * Thin compatibility wrapper over a local JsonBranchRegistryStore plus
 * SupabaseRegistrySyncClientImpl for cross-machine sync.
 */

import type { StorageAdapter, Branch } from './adapter.js';
import { JsonBranchRegistryStore } from './json-branch-registry-store.js';
import {
    SupabaseRegistrySyncClientImpl,
    type SupabaseBranchRow,
    type SupabaseRegistrySyncClientConfig,
} from './supabase-registry-sync-client-impl.js';
import type {
    CrossMachineConflict,
    MachineIdentity,
    MachineRegistryView,
    RegistryStatus,
    RegistrySyncResult,
} from '../types/cloud.js';

export class SupabaseStorage implements StorageAdapter {
    private store: JsonBranchRegistryStore;
    private syncClient: SupabaseRegistrySyncClientImpl;

    constructor(config: SupabaseRegistrySyncClientConfig, basePath: string = process.cwd()) {
        this.store = new JsonBranchRegistryStore(basePath);
        this.syncClient = new SupabaseRegistrySyncClientImpl(config);
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

    async cleanup(olderThan: Date): Promise<string[]> {
        return this.store.cleanup(olderThan);
    }

    async setDependencies(name: string, dependsOn: string[]): Promise<void> {
        await this.syncClient.setDependencies(name, dependsOn);
    }

    async setConflicts(name: string, conflictsWith: string[]): Promise<void> {
        await this.syncClient.setConflicts(name, conflictsWith);
    }

    async markMerged(name: string, prNumber?: number): Promise<void> {
        await this.syncClient.markMerged(name, prNumber);
    }

    async getStale(): Promise<Branch[]> {
        return this.syncClient.getStale();
    }

    async getRaw(name: string): Promise<SupabaseBranchRow | null> {
        return this.syncClient.getRaw(name);
    }

    async pushRegistry(
        machine: MachineIdentity,
        repoName: string,
        repoPath: string,
        branches: Branch[],
    ): Promise<RegistrySyncResult> {
        return this.syncClient.push(machine, repoName, repoPath, branches);
    }

    async pullRegistries(repoName: string, excludeMachine?: string): Promise<MachineRegistryView[]> {
        return this.syncClient.pull(repoName, excludeMachine);
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

    async pushGitHubBranches(rows: unknown[]): Promise<number> {
        return this.syncClient.pushGitHubBranches(rows);
    }
}
