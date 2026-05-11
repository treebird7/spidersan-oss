import type { Branch } from './adapter.js';
import type { BranchRegistryStore } from './branch-registry-store.js';

function cloneBranch(branch: Branch): Branch {
    return {
        ...branch,
        files: [...branch.files],
        registeredAt: new Date(branch.registeredAt),
    };
}

export class MemoryBranchRegistryStore implements BranchRegistryStore {
    private initialized = false;
    private branches = new Map<string, Branch>();

    async init(): Promise<void> {
        this.initialized = true;
    }

    async isInitialized(): Promise<boolean> {
        return this.initialized;
    }

    async list(): Promise<Branch[]> {
        return Array.from(this.branches.values()).map(cloneBranch);
    }

    async register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch> {
        const created: Branch = {
            ...branch,
            registeredAt: new Date(),
        };
        this.branches.set(branch.name, created);
        return cloneBranch(created);
    }

    async update(name: string, updates: Partial<Branch>): Promise<Branch | null> {
        const existing = this.branches.get(name);
        if (!existing) {
            return null;
        }

        const updated: Branch = {
            ...existing,
            ...updates,
            name,
        };
        this.branches.set(name, updated);
        return cloneBranch(updated);
    }

    async unregister(name: string): Promise<boolean> {
        return this.branches.delete(name);
    }

    async get(name: string): Promise<Branch | null> {
        const branch = this.branches.get(name);
        return branch ? cloneBranch(branch) : null;
    }

    async findByFiles(files: string[]): Promise<Branch[]> {
        const fileSet = new Set(files);
        return Array.from(this.branches.values())
            .filter((branch) => branch.files.some((file) => fileSet.has(file)))
            .map(cloneBranch);
    }

    async cleanup(olderThan: Date): Promise<string[]> {
        const removed: string[] = [];
        for (const [name, branch] of this.branches.entries()) {
            if (branch.registeredAt < olderThan) {
                this.branches.delete(name);
                removed.push(name);
            }
        }
        return removed;
    }
}
