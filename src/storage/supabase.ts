/**
 * Supabase Storage Adapter
 * 
 * Cloud-based storage for team coordination.
 * Matches Recovery-Tree's branch_registry schema.
 */

import type { StorageAdapter, Branch } from './adapter.js';
import type {
    SpiderRegistry,
    MachineIdentity,
    MachineRegistryView,
    RegistryStatus,
    RegistrySyncResult,
} from '../types/cloud.js';

interface SupabaseConfig {
    url: string;
    key: string;
    projectId?: string;
}

// Message types matching the database schema


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
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'apikey': this.key,
                    'Authorization': `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    'Prefer': 'return=representation',
                    ...options.headers,
                },
            });

            // Check for common errors and provide helpful messages
            if (!response.ok) {
                const text = await response.text();
                let parsed: { message?: string; hint?: string } = {};
                try { parsed = JSON.parse(text); } catch { /* ignore */ }

                if (parsed.message?.includes('Invalid API key')) {
                    throw new Error(
                        'Invalid Supabase API key.\n' +
                        '  Hint: Check your SUPABASE_KEY environment variable.\n' +
                        '  Note: A local .env file may be overriding your mycmail config.'
                    );
                }

                if (response.status === 401 || response.status === 403) {
                    throw new Error(
                        'Supabase authentication failed.\n' +
                        '  • Check SUPABASE_URL and SUPABASE_KEY are correct\n' +
                        '  • Verify RLS policies allow access\n' +
                        '  • Check for .env conflicts in current directory'
                    );
                }

                throw new Error(`Supabase error (${response.status}): ${parsed.message || text}`);
            }

            return response;
        } catch (error) {
            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error(
                    'Network error connecting to Supabase.\n' +
                    '  • Check your internet connection\n' +
                    '  • Verify SUPABASE_URL is correct'
                );
            }
            throw error;
        }
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
            created_by_agent: branch.agent || 'unknown',
            created_by_session: branch.agent || 'cli-session',
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
        // Security: URL-encode file paths to prevent query injection
        const safeFiles = files.map(f => encodeURIComponent(f.replace(/[,{}]/g, '_')));
        const response = await this.fetch(`active_branches?files_changed=ov.{${safeFiles.join(',')}}`);
        if (!response.ok) throw new Error(`Failed to find by files: ${await response.text()}`);
        const rows = await response.json() as SupabaseBranchRow[];
        return rows.map(r => this.rowToBranch(r));
    }

    async cleanup(olderThan: Date): Promise<string[]> {
        const isoDate = olderThan.toISOString();
        const response = await this.fetch(`branch_registry?select=id,branch_name&state=eq.active&created_at=lt.${encodeURIComponent(isoDate)}`);
        if (!response.ok) throw new Error(`Failed to get stale branches: ${await response.text()}`);

        const rows = await response.json() as { id: string; branch_name: string }[];
        if (rows.length === 0) return [];

        const ids = rows.map(r => r.id);
        const names = rows.map(r => r.branch_name);

        const patchResponse = await this.fetch(`branch_registry?id=in.(${ids.join(',')})`, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'abandoned', updated_at: new Date().toISOString() }),
        });
        if (!patchResponse.ok) throw new Error(`Failed to cleanup branches: ${await patchResponse.text()}`);

        return names;
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

    // ─── F1: Registry Sync (cross-machine awareness) ───

    /**
     * Push local branches to spider_registries table, tagged with machine identity.
     * Uses upsert (ON CONFLICT UPDATE) to handle repeated pushes.
     */
    async pushRegistry(
        machine: MachineIdentity,
        repoName: string,
        repoPath: string,
        branches: Branch[],
    ): Promise<RegistrySyncResult> {
        const result: RegistrySyncResult = { pushed: 0, updated: 0, abandoned: 0, errors: [] };

        // Upsert each branch
        const rows = branches.map(b => ({
            machine_id: machine.id,
            machine_name: machine.name,
            hostname: machine.hostname,
            repo_path: repoPath,
            repo_name: repoName,
            branch_name: b.name,
            files: b.files,
            agent: b.agent || null,
            description: b.description || null,
            status: b.status,
            synced_at: new Date().toISOString(),
        }));

        if (rows.length > 0) {
            const response = await this.fetch(
                'spider_registries?on_conflict=machine_id,repo_name,branch_name',
                {
                    method: 'POST',
                    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' },
                    body: JSON.stringify(rows),
                },
            );

            if (!response.ok) {
                const text = await response.text();
                result.errors.push(`Push failed: ${text}`);
                return result;
            }

            result.pushed = rows.filter(r => r.status === 'active').length;
            result.updated = rows.length - result.pushed;
        }

        // Mark branches that exist in Supabase for this machine+repo but not locally
        const localNames = new Set(branches.map(b => b.name));
        const existingResp = await this.fetch(
            `spider_registries?machine_id=eq.${encodeURIComponent(machine.id)}` +
            `&repo_name=eq.${encodeURIComponent(repoName)}` +
            `&status=eq.active&select=branch_name`,
        );

        if (existingResp.ok) {
            const existing = await existingResp.json() as Array<{ branch_name: string }>;
            const toAbandon = existing.filter(e => !localNames.has(e.branch_name));

            for (const row of toAbandon) {
                await this.fetch(
                    `spider_registries?machine_id=eq.${encodeURIComponent(machine.id)}` +
                    `&repo_name=eq.${encodeURIComponent(repoName)}` +
                    `&branch_name=eq.${encodeURIComponent(row.branch_name)}`,
                    {
                        method: 'PATCH',
                        body: JSON.stringify({ status: 'abandoned', synced_at: new Date().toISOString() }),
                    },
                );
                result.abandoned++;
            }
        }

        return result;
    }

    /**
     * Pull other machines' registries for a repo (read-only view).
     */
    async pullRegistries(repoName: string, excludeMachine?: string): Promise<MachineRegistryView[]> {
        let query = `spider_registries?repo_name=eq.${encodeURIComponent(repoName)}&status=eq.active&order=synced_at.desc`;
        if (excludeMachine) {
            query += `&machine_id=neq.${encodeURIComponent(excludeMachine)}`;
        }

        const response = await this.fetch(query);
        if (!response.ok) throw new Error(`Pull failed: ${await response.text()}`);

        const rows = await response.json() as SpiderRegistry[];

        // Group by machine
        const byMachine = new Map<string, MachineRegistryView>();
        for (const row of rows) {
            if (!byMachine.has(row.machine_id)) {
                byMachine.set(row.machine_id, {
                    machine_id: row.machine_id,
                    machine_name: row.machine_name,
                    hostname: row.hostname,
                    branches: [],
                    last_sync: row.synced_at,
                });
            }
            const view = byMachine.get(row.machine_id)!;
            view.branches.push(row);
            if (row.synced_at > view.last_sync) {
                view.last_sync = row.synced_at;
            }
        }

        return Array.from(byMachine.values());
    }

    /**
     * Get sync status across all machines for a repo (or all repos).
     */
    async getRegistryStatus(repoName?: string): Promise<RegistryStatus[]> {
        let query = 'spider_registries?select=machine_id,machine_name,hostname,repo_name,status,synced_at';
        if (repoName) {
            query += `&repo_name=eq.${encodeURIComponent(repoName)}`;
        }

        const response = await this.fetch(query);
        if (!response.ok) throw new Error(`Status failed: ${await response.text()}`);

        const rows = await response.json() as SpiderRegistry[];

        // Aggregate by machine
        const byMachine = new Map<string, RegistryStatus>();
        for (const row of rows) {
            if (!byMachine.has(row.machine_id)) {
                byMachine.set(row.machine_id, {
                    machine_id: row.machine_id,
                    machine_name: row.machine_name,
                    hostname: row.hostname,
                    branch_count: 0,
                    active_count: 0,
                    last_sync: row.synced_at,
                    repos: [],
                });
            }
            const status = byMachine.get(row.machine_id)!;
            status.branch_count++;
            if (row.status === 'active') status.active_count++;
            if (row.synced_at > status.last_sync) status.last_sync = row.synced_at;
            if (!status.repos.includes(row.repo_name)) status.repos.push(row.repo_name);
        }

        return Array.from(byMachine.values());
    }

}
