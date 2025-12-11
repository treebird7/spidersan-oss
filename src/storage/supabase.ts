/**
 * Supabase Storage Adapter
 * 
 * Cloud-based storage for team coordination.
 * Matches Recovery-Tree's branch_registry schema.
 */

import type { StorageAdapter, Branch, BranchRegistry } from './adapter.js';

interface SupabaseConfig {
    url: string;
    key: string;
    projectId?: string;
}

interface SupabaseBranchRow {
    id: string;
    branch_name: string;
    created_by_session: string | null;
    created_by_agent: string | null;
    parent_branch: string;
    state: string;
    depends_on: string[] | null;
    conflict_with: string[] | null;
    files_changed: string[] | null;
    description: string | null;
    pr_number: number | null;
    created_at: string;
    updated_at: string;
}

export class SupabaseStorage implements StorageAdapter {
    private url: string;
    private key: string;
    private projectId: string;
    private initialized = false;

    constructor(config: SupabaseConfig) {
        this.url = config.url;
        this.key = config.key;
        this.projectId = config.projectId || 'default';
    }

    private async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.url}/rest/v1/${endpoint}`;
        return fetch(url, {
            ...options,
            headers: {
                'apikey': this.key,
                'Authorization': `Bearer ${this.key}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation',
                ...options.headers,
            },
        });
    }

    private rowToBranch(row: SupabaseBranchRow): Branch {
        return {
            name: row.branch_name,
            files: row.files_changed || [],
            registeredAt: new Date(row.created_at),
            agent: row.created_by_agent || undefined,
            status: row.state === 'active' ? 'active' :
                row.state === 'merged' ? 'completed' : 'abandoned',
            description: row.description || undefined,
        };
    }

    async init(): Promise<void> {
        if (!this.url || !this.key) {
            throw new Error('Supabase URL and key required. Set SUPABASE_URL and SUPABASE_KEY env vars.');
        }

        const response = await this.fetch('branch_registry?select=id&limit=1');
        if (!response.ok) {
            throw new Error(`Failed to connect to Supabase: ${await response.text()}`);
        }

        this.initialized = true;
    }

    async isInitialized(): Promise<boolean> {
        if (this.initialized) return true;
        try {
            await this.init();
            return true;
        } catch {
            return false;
        }
    }

    async list(): Promise<Branch[]> {
        const response = await this.fetch('active_branches?select=*&order=created_at.desc');
        if (!response.ok) throw new Error(`Failed to list: ${await response.text()}`);

        const rows = await response.json() as SupabaseBranchRow[];
        return rows.map(r => this.rowToBranch(r));
    }

    async register(branch: Omit<Branch, 'registeredAt'>): Promise<Branch> {
        const payload = {
            branch_name: branch.name,
            files_changed: branch.files,
            state: branch.status || 'active',
            description: branch.description,
            created_by_agent: branch.agent,
            parent_branch: 'main',
        };

        const response = await this.fetch('branch_registry', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            const error = await response.text();
            if (error.includes('duplicate') || error.includes('unique')) {
                throw new Error(`Branch "${branch.name}" already registered`);
            }
            throw new Error(`Failed to register: ${error}`);
        }

        const [row] = await response.json() as SupabaseBranchRow[];
        return this.rowToBranch(row);
    }

    async update(name: string, updates: Partial<Branch>): Promise<Branch | null> {
        const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (updates.files) payload.files_changed = updates.files;
        if (updates.status) payload.state = updates.status;
        if (updates.description) payload.description = updates.description;
        if (updates.agent) payload.created_by_agent = updates.agent;

        const response = await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });

        if (!response.ok) throw new Error(`Failed to update: ${await response.text()}`);
        const rows = await response.json() as SupabaseBranchRow[];
        return rows.length > 0 ? this.rowToBranch(rows[0]) : null;
    }

    async unregister(name: string): Promise<boolean> {
        const response = await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'abandoned', updated_at: new Date().toISOString() }),
        });
        if (!response.ok) throw new Error(`Failed to unregister: ${await response.text()}`);
        const rows = await response.json() as SupabaseBranchRow[];
        return rows.length > 0;
    }

    async get(name: string): Promise<Branch | null> {
        const response = await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}&limit=1`);
        if (!response.ok) throw new Error(`Failed to get: ${await response.text()}`);
        const rows = await response.json() as SupabaseBranchRow[];
        return rows.length > 0 ? this.rowToBranch(rows[0]) : null;
    }

    async findByFiles(files: string[]): Promise<Branch[]> {
        const response = await this.fetch(`active_branches?files_changed=ov.{${files.join(',')}}`);
        if (!response.ok) throw new Error(`Failed to find by files: ${await response.text()}`);
        const rows = await response.json() as SupabaseBranchRow[];
        return rows.map(r => this.rowToBranch(r));
    }

    async cleanup(olderThan: Date): Promise<number> {
        const response = await this.fetch('stale_branches?select=id');
        if (!response.ok) throw new Error(`Failed to get stale: ${await response.text()}`);

        const rows = await response.json() as { id: string }[];
        if (rows.length === 0) return 0;

        const ids = rows.map(r => r.id);
        await this.fetch(`branch_registry?id=in.(${ids.join(',')})`, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'abandoned', updated_at: new Date().toISOString() }),
        });
        return rows.length;
    }

    // Extended Supabase-specific methods
    async setDependencies(name: string, dependsOn: string[]): Promise<void> {
        await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ depends_on: dependsOn, updated_at: new Date().toISOString() }),
        });
    }

    async setConflicts(name: string, conflictsWith: string[]): Promise<void> {
        await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ conflict_with: conflictsWith, updated_at: new Date().toISOString() }),
        });
    }

    async markMerged(name: string, prNumber?: number): Promise<void> {
        const payload: Record<string, unknown> = { state: 'merged', updated_at: new Date().toISOString() };
        if (prNumber) payload.pr_number = prNumber;
        await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    }

    async getStale(): Promise<Branch[]> {
        const response = await this.fetch('stale_branches?select=*');
        if (!response.ok) throw new Error(`Failed to get stale: ${await response.text()}`);
        const rows = await response.json() as SupabaseBranchRow[];
        return rows.map(r => this.rowToBranch(r));
    }

    async getRaw(name: string): Promise<SupabaseBranchRow | null> {
        const response = await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(name)}&limit=1`);
        if (!response.ok) return null;
        const rows = await response.json() as SupabaseBranchRow[];
        return rows[0] || null;
    }
}
