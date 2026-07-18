/**
 * Storage Adapter Interface
 * 
 * Abstract interface for branch registry storage.
 * Implementations: LocalStorage (JSON), SupabaseStorage (Pro)
 */

export interface Branch {
    name: string;
    files: string[];
    registeredAt: Date;
    agent?: string;
    status: 'active' | 'completed' | 'abandoned';
    description?: string;
    /** Branches that must merge BEFORE this one (`spidersan depends`). */
    dependsOn?: string[];
    /** PR that merged this branch (`spidersan merged --pr`). */
    prNumber?: number;
    /**
     * Per-file claims: who's actively touching which file on this branch,
     * right now. Populated automatically by `watch` on every registered
     * change (so an agent that's never heard of spidersan still gets
     * claimed), or explicitly via `spidersan claim`/`release`.
     */
    claims?: Record<string, { agent: string; at: string }>;
}

export interface BranchRegistry {
    branches: Record<string, Branch>;
    version: string;
    projectId?: string;
}

/**
 * @deprecated Use BranchRegistryStore for local registry access and
 * SupabaseRegistrySyncClient for cross-machine sync.
 */
export interface StorageAdapter {
    /**
     * Initialize the storage (create directories, connect to DB, etc.)
     */
    init(): Promise<void>;

    /**
     * Check if storage is initialized
     */
    isInitialized(): Promise<boolean>;

    /**
     * Get all registered branches
     */
    list(): Promise<Branch[]>;

    /**
     * Register a new branch
     */
    register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch>;

    /**
     * Update an existing branch
     */
    update(name: string, updates: Partial<Branch>): Promise<Branch | null>;

    /**
     * Unregister a branch
     */
    unregister(name: string): Promise<boolean>;

    /**
     * Get a specific branch by name
     */
    get(name: string): Promise<Branch | null>;

    /**
     * Find branches that touch specific files
     */
    findByFiles(files: string[]): Promise<Branch[]>;

    /**
     * Clean up old branches
     */
    cleanup(olderThan: Date, includeActive?: boolean): Promise<string[]>;
}
