/**
 * Local JSON Storage Adapter
 *
 * Thin compatibility wrapper over JsonBranchRegistryStore.
 */

import type { StorageAdapter, Branch } from './adapter.js';
import { JsonBranchRegistryStore } from './json-branch-registry-store.js';

export class LocalStorage implements StorageAdapter {
    private store: JsonBranchRegistryStore;

    constructor(basePath: string = process.cwd()) {
        this.store = new JsonBranchRegistryStore(basePath);
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
}
