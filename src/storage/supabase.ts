/**
 * Supabase Storage Adapter
 * 
 * Cloud-based storage for team coordination.
 * Matches Recovery-Tree's branch_registry schema.
 */

import type { StorageAdapter, Branch } from './adapter.js';
import type { MachineIdentity, MachineRegistryView } from '../types/cloud.js';

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

    async cleanup(_olderThan: Date): Promise<number> {
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

    // ─── F1: Cross-Machine Registry Sync ───────────────────────────────────────

    /**
     * Push local branches to Supabase, tagged with machine identity.
     * Uses branch_registry with machine_id columns (migration 20260220).
     */
    async pushRegistry(machine: MachineIdentity, repoName: string, repoPath: string, branches: Branch[]): Promise<{ pushed: number; updated: number; abandoned: number; errors: string[] }> {
        let pushed = 0, updated = 0;
        const errors: string[] = [];
        for (const branch of branches) {
            try {
                const payload = {
                    branch_name: branch.name,
                    state: branch.status === 'active' ? 'active' : branch.status,
                    files_changed: branch.files,
                    description: branch.description || null,
                    created_by_agent: branch.agent || null,
                    machine_id: machine.id,
                    machine_name: machine.name,
                    hostname: machine.hostname,
                    repo_name: repoName,
                    repo_path: repoPath,
                    updated_at: new Date().toISOString(),
                };
                const check = await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(branch.name)}&machine_id=eq.${encodeURIComponent(machine.id)}`);
                const existing = check.ok ? (await check.json() as unknown[]) : [];
                if (Array.isArray(existing) && existing.length > 0) {
                    await this.fetch(`branch_registry?branch_name=eq.${encodeURIComponent(branch.name)}&machine_id=eq.${encodeURIComponent(machine.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify(payload),
                    });
                    updated++;
                } else {
                    await this.fetch('branch_registry', {
                        method: 'POST',
                        body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
                    });
                    pushed++;
                }
            } catch (err) {
                errors.push(`${branch.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return { pushed, updated, abandoned: 0, errors };
    }

    /**
     * Pull registries from all OTHER machines (for cross-machine conflict detection).
     */
    async pullRegistries(repoName: string, excludeMachineId?: string): Promise<MachineRegistryView[]> {
        let endpoint = `branch_registry?repo_name=eq.${encodeURIComponent(repoName)}&state=neq.abandoned&state=neq.merged`;
        if (excludeMachineId) {
            endpoint += `&machine_id=neq.${encodeURIComponent(excludeMachineId)}`;
        }
        const response = await this.fetch(endpoint);
        if (!response.ok) throw new Error(`Failed to pull registries: ${await response.text()}`);
        const rows = await response.json() as (SupabaseBranchRow & { machine_id?: string; machine_name?: string; repo_name?: string })[];

        // Group by machine_id
        const byMachine = new Map<string, typeof rows>();
        for (const row of rows) {
            const mid = row.machine_id || 'unknown';
            if (!byMachine.has(mid)) byMachine.set(mid, []);
            byMachine.get(mid)!.push(row);
        }

        const views: MachineRegistryView[] = [];
        for (const [machineId, machineRows] of byMachine) {
            views.push({
                machine_id: machineId,
                machine_name: machineRows[0].machine_name || machineId,
                hostname: (machineRows[0] as unknown as { hostname?: string }).hostname || 'unknown',
                repo_name: machineRows[0].repo_name || repoName,
                repo_path: (machineRows[0] as unknown as { repo_path?: string }).repo_path || '',
                branches: machineRows.map(r => this.rowToBranch(r)),
                last_synced: machineRows.reduce((latest, r) => r.updated_at > latest ? r.updated_at : latest, ''),
            });
        }
        return views;
    }

    /**
     * Get registry sync status for this machine's repos.
     */
    async getRegistryStatus(repoName?: string): Promise<MachineRegistryView[]> {
        let endpoint = 'branch_registry?state=neq.abandoned&machine_id=not.is.null';
        if (repoName) endpoint += `&repo_name=eq.${encodeURIComponent(repoName)}`;
        const response = await this.fetch(endpoint);
        if (!response.ok) throw new Error(`Failed to get registry status: ${await response.text()}`);
        const rows = await response.json() as (SupabaseBranchRow & { machine_id?: string; machine_name?: string; repo_name?: string })[];

        const byMachine = new Map<string, typeof rows>();
        for (const row of rows) {
            const mid = row.machine_id || 'unknown';
            if (!byMachine.has(mid)) byMachine.set(mid, []);
            byMachine.get(mid)!.push(row);
        }

        return Array.from(byMachine.entries()).map(([machineId, machineRows]) => ({
            machine_id: machineId,
            machine_name: machineRows[0].machine_name || machineId,
            hostname: (machineRows[0] as unknown as { hostname?: string }).hostname || 'unknown',
            repo_name: machineRows[0].repo_name || repoName || 'unknown',
            repo_path: (machineRows[0] as unknown as { repo_path?: string }).repo_path || '',
            branches: machineRows.map(r => this.rowToBranch(r)),
            last_synced: machineRows.reduce((latest, r) => r.updated_at > latest ? r.updated_at : latest, ''),
        }));
    }

}
