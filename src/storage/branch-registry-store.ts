import type { Branch } from './adapter.js';

export interface BranchRegistryStore {
    init(): Promise<void>;
    isInitialized(): Promise<boolean>;
    list(): Promise<Branch[]>;
    register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch>;
    update(name: string, updates: Partial<Branch>): Promise<Branch | null>;
    unregister(name: string): Promise<boolean>;
    get(name: string): Promise<Branch | null>;
    findByFiles(files: string[]): Promise<Branch[]>;
    cleanup(olderThan: Date): Promise<string[]>;
}
