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
}

export interface BranchRegistry {
    branches: Record<string, Branch>;
    version: string;
    projectId?: string;
}

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
    cleanup(olderThan: Date): Promise<number>;
}
