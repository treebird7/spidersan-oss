import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import type { Branch, BranchRegistry } from './adapter.js';
import type { BranchRegistryStore } from './branch-registry-store.js';

const SPIDERSAN_DIR = '.spidersan';
const REGISTRY_FILE = 'registry.json';
const REGISTRY_VERSION = '1.0';

type StoredBranch = Omit<Branch, 'registeredAt'> & { registeredAt: string | Date };
type StoredBranchRegistry = Omit<BranchRegistry, 'branches'> & {
    branches: Record<string, StoredBranch>;
};

function normalizeBranch(branch: StoredBranch): Branch {
    return {
        ...branch,
        registeredAt: branch.registeredAt instanceof Date
            ? branch.registeredAt
            : new Date(branch.registeredAt),
    };
}

function normalizeRegistry(registry: StoredBranchRegistry): BranchRegistry {
    return {
        ...registry,
        branches: Object.fromEntries(
            Object.entries(registry.branches).map(([name, branch]) => [name, normalizeBranch(branch)]),
        ),
    };
}

export class JsonBranchRegistryStore implements BranchRegistryStore {
    private basePath: string;
    private registryPath: string;

    constructor(basePath: string = process.cwd()) {
        this.basePath = basePath;
        this.registryPath = join(basePath, SPIDERSAN_DIR, REGISTRY_FILE);
    }

    async init(): Promise<void> {
        const dir = join(this.basePath, SPIDERSAN_DIR);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }

        if (!existsSync(this.registryPath)) {
            await this.save({ branches: {}, version: REGISTRY_VERSION });
        }
    }

    async isInitialized(): Promise<boolean> {
        return existsSync(this.registryPath);
    }

    async list(): Promise<Branch[]> {
        const registry = await this.load();
        return Object.values(registry.branches);
    }

    async register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch> {
        const registry = await this.load();
        const newBranch: Branch = {
            ...branch,
            registeredAt: new Date(),
        };

        registry.branches[branch.name] = newBranch;
        await this.save(registry);
        return newBranch;
    }

    async update(name: string, updates: Partial<Branch>): Promise<Branch | null> {
        const registry = await this.load();
        if (!registry.branches[name]) {
            return null;
        }

        registry.branches[name] = {
            ...registry.branches[name],
            ...updates,
            name,
        };
        await this.save(registry);
        return registry.branches[name];
    }

    async unregister(name: string): Promise<boolean> {
        const registry = await this.load();
        if (!registry.branches[name]) {
            return false;
        }

        delete registry.branches[name];
        await this.save(registry);
        return true;
    }

    async get(name: string): Promise<Branch | null> {
        const registry = await this.load();
        return registry.branches[name] || null;
    }

    async findByFiles(files: string[]): Promise<Branch[]> {
        const branches = await this.list();
        const fileSet = new Set(files);
        return branches.filter((branch) => branch.files.some((file) => fileSet.has(file)));
    }

    async cleanup(olderThan: Date): Promise<string[]> {
        const registry = await this.load();
        const removedNames: string[] = [];

        for (const [name, branch] of Object.entries(registry.branches)) {
            if (branch.registeredAt < olderThan) {
                delete registry.branches[name];
                removedNames.push(name);
            }
        }

        if (removedNames.length > 0) {
            await this.save(registry);
        }

        return removedNames;
    }

    private async load(): Promise<BranchRegistry> {
        try {
            const data = await readFile(this.registryPath, 'utf-8');
            return normalizeRegistry(JSON.parse(data) as StoredBranchRegistry);
        } catch {
            return { branches: {}, version: REGISTRY_VERSION };
        }
    }

    private async save(registry: BranchRegistry): Promise<void> {
        await writeFile(this.registryPath, JSON.stringify(registry, null, 2));
    }
}
