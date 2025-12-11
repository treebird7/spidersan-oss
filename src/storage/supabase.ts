/**
 * Supabase Storage Adapter (Pro Feature)
 * 
 * Cloud-based storage for team coordination.
 * Requires valid Pro license and Supabase project.
 */

import type { StorageAdapter, Branch, BranchRegistry } from './adapter.js';

// TODO: Add @supabase/supabase-js dependency when implementing

export class SupabaseStorage implements StorageAdapter {
    private url: string;
    private key: string;
    private projectId: string;

    constructor(config: { url: string; key: string; projectId: string }) {
        this.url = config.url;
        this.key = config.key;
        this.projectId = config.projectId;
    }

    async init(): Promise<void> {
        // TODO: Initialize Supabase client and verify connection
        throw new Error('Supabase storage is a Pro feature. Please upgrade to use cloud sync.');
    }

    async isInitialized(): Promise<boolean> {
        // TODO: Check if project exists in Supabase
        return false;
    }

    async list(): Promise<Branch[]> {
        throw new Error('Supabase storage is a Pro feature.');
    }

    async register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch> {
        throw new Error('Supabase storage is a Pro feature.');
    }

    async update(name: string, updates: Partial<Branch>): Promise<Branch | null> {
        throw new Error('Supabase storage is a Pro feature.');
    }

    async unregister(name: string): Promise<boolean> {
        throw new Error('Supabase storage is a Pro feature.');
    }

    async get(name: string): Promise<Branch | null> {
        throw new Error('Supabase storage is a Pro feature.');
    }

    async findByFiles(files: string[]): Promise<Branch[]> {
        throw new Error('Supabase storage is a Pro feature.');
    }

    async cleanup(olderThan: Date): Promise<number> {
        throw new Error('Supabase storage is a Pro feature.');
    }
}
