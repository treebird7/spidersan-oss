import { classifyTier } from '../lib/conflict-tier.js';
import type { Branch } from './adapter.js';
import type { SupabaseRegistrySyncClient } from './supabase-registry-sync-client.js';
import type {
    CrossMachineConflict,
    MachineIdentity,
    MachineRegistryView,
    RegistryStatus,
    RegistrySyncResult,
} from '../types/cloud.js';

export interface SupabaseRegistrySyncClientConfig {
    url: string;
    key: string;
    projectId?: string;
    fetchFn?: typeof fetch;
}

export interface SupabaseBranchRow {
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

interface SpiderRegistryRow {
    branch_name: string;
    status: string;
    files: string[] | null;
    agent: string | null;
    description: string | null;
    created_at: string;
    synced_at: string;
    machine_id: string;
    machine_name: string;
    hostname: string;
    repo_name: string;
    repo_path: string;
}

interface BranchRef {
    branch_name: string;
    machine_id: string;
    machine_name: string;
    agent: string | null;
}

export class SupabaseRegistrySyncClientImpl implements SupabaseRegistrySyncClient {
    private url: string;
    private key: string;
    private projectId: string;
    private fetchFn: typeof fetch;

    constructor(config: SupabaseRegistrySyncClientConfig) {
        this.url = config.url;
        this.key = config.key;
        this.projectId = config.projectId || 'default';
        this.fetchFn = config.fetchFn || fetch;
    }

    async push(
        machine: MachineIdentity,
        repoName: string,
        repoPath: string,
        branches: Branch[],
    ): Promise<RegistrySyncResult> {
        const result: RegistrySyncResult = { pushed: 0, updated: 0, abandoned: 0, errors: [] };
        const now = new Date().toISOString();

        const rows = branches.map((branch) => ({
            branch_name: branch.name,
            machine_id: machine.id,
            machine_name: machine.name,
            hostname: machine.hostname,
            repo_name: repoName,
            repo_path: repoPath,
            status: branch.status === 'completed' ? 'merged' : branch.status,
            files: branch.files,
            agent: branch.agent || machine.name,
            description: branch.description || null,
            synced_at: now,
            project_id: this.projectId,
        }));

        if (rows.length > 0) {
            const upsertResp = await this.fetchFromSupabase(
                'spider_registries?on_conflict=machine_id,repo_name,branch_name',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Prefer: 'resolution=merge-duplicates',
                    },
                    body: JSON.stringify(rows),
                },
            );

            if (upsertResp.ok) {
                for (const branch of branches) {
                    if (branch.status === 'active') {
                        result.pushed++;
                    } else {
                        result.updated++;
                    }
                }
            } else {
                result.errors.push(`Failed to bulk upsert: ${await upsertResp.text()}`);
            }
        }

        const localNames = new Set(branches.map((branch) => branch.name));
        const existingResp = await this.fetchFromSupabase(
            `spider_registries?machine_id=eq.${encodeURIComponent(machine.id)}` +
            `&repo_name=eq.${encodeURIComponent(repoName)}` +
            '&status=eq.active&select=branch_name',
        );

        if (existingResp.ok) {
            const existing = await existingResp.json() as Array<{ branch_name: string }>;
            const toAbandon = existing.filter((row) => !localNames.has(row.branch_name));

            if (toAbandon.length > 0) {
                const encodedNames = toAbandon.map((row) => encodeURIComponent(row.branch_name));
                const patchResp = await this.fetchFromSupabase(
                    `spider_registries?machine_id=eq.${encodeURIComponent(machine.id)}` +
                    `&branch_name=in.(${encodedNames.join(',')})`,
                    { method: 'PATCH', body: JSON.stringify({ status: 'abandoned', synced_at: now }) },
                );

                if (patchResp.ok) {
                    result.abandoned += toAbandon.length;
                } else {
                    result.errors.push(`Failed to batch abandon: ${await patchResp.text()}`);
                }
            }
        }

        return result;
    }

    async pull(repoName: string, excludeMachine?: string): Promise<MachineRegistryView[]> {
        let query = `spider_registries?machine_id=not.is.null&repo_name=eq.${encodeURIComponent(repoName)}` +
            '&status=eq.active&order=synced_at.desc';
        if (excludeMachine) {
            query += `&machine_id=neq.${encodeURIComponent(excludeMachine)}`;
        }

        const response = await this.fetchFromSupabase(query);
        if (!response.ok) {
            throw new Error(`Pull failed: ${await response.text()}`);
        }

        const rows = await response.json() as SpiderRegistryRow[];
        const byMachine = new Map<string, MachineRegistryView>();

        for (const row of rows) {
            if (!byMachine.has(row.machine_id)) {
                byMachine.set(row.machine_id, {
                    machine_id: row.machine_id,
                    machine_name: row.machine_name,
                    hostname: row.hostname,
                    repo_name: row.repo_name,
                    repo_path: row.repo_path,
                    branches: [],
                    last_synced: row.synced_at,
                });
            }

            const view = byMachine.get(row.machine_id)!;
            view.branches.push({
                name: row.branch_name,
                files: row.files ?? [],
                agent: row.agent ?? undefined,
                description: row.description ?? undefined,
                status: row.status === 'merged' ? 'completed' : (row.status as Branch['status']),
                registeredAt: new Date(row.created_at),
            });

            if (row.synced_at > view.last_synced) {
                view.last_synced = row.synced_at;
            }
        }

        return Array.from(byMachine.values());
    }

    async getStatus(repoName?: string): Promise<RegistryStatus[]> {
        let query =
            'spider_registries?machine_id=not.is.null&select=machine_id,machine_name,hostname,repo_name,status,synced_at';
        if (repoName) {
            query += `&repo_name=eq.${encodeURIComponent(repoName)}`;
        }

        const response = await this.fetchFromSupabase(query);
        if (!response.ok) {
            throw new Error(`Status failed: ${await response.text()}`);
        }

        const rows = await response.json() as Array<{
            machine_id: string;
            machine_name: string;
            hostname: string;
            repo_name: string;
            status: string;
            synced_at: string;
        }>;

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
            if (row.status === 'active') {
                status.active_count++;
            }
            if (row.synced_at > status.last_sync) {
                status.last_sync = row.synced_at;
            }
            if (!status.repos.includes(row.repo_name)) {
                status.repos.push(row.repo_name);
            }
        }

        return Array.from(byMachine.values());
    }

    async detectCrossMachineConflicts(
        repoName: string,
        excludeMachine?: string,
    ): Promise<CrossMachineConflict[]> {
        const machines = await this.pull(repoName, excludeMachine);
        const fileMap = new Map<string, BranchRef[]>();

        for (const machine of machines) {
            for (const branch of machine.branches) {
                if (branch.status !== 'active') {
                    continue;
                }

                for (const file of branch.files) {
                    if (!fileMap.has(file)) {
                        fileMap.set(file, []);
                    }
                    fileMap.get(file)!.push({
                        branch_name: branch.name,
                        machine_id: machine.machine_id,
                        machine_name: machine.machine_name,
                        agent: branch.agent ?? null,
                    });
                }
            }
        }

        const conflicts: CrossMachineConflict[] = [];
        for (const [file, refs] of fileMap.entries()) {
            if (new Set(refs.map((ref) => ref.machine_id)).size < 2) {
                continue;
            }

            conflicts.push({
                file,
                tier: classifyTier(file),
                branches: refs.map((ref) => ({
                    branch_name: ref.branch_name,
                    machine_id: ref.machine_id,
                    machine_name: ref.machine_name,
                    agent: ref.agent,
                })),
            });
        }

        conflicts.sort((a, b) => b.tier - a.tier);
        return conflicts;
    }

    async setDependencies(name: string, dependsOn: string[]): Promise<void> {
        await this.fetchFromSupabase(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ depends_on: dependsOn, updated_at: new Date().toISOString() }),
        });
    }

    async setConflicts(name: string, conflictsWith: string[]): Promise<void> {
        await this.fetchFromSupabase(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify({ conflict_with: conflictsWith, updated_at: new Date().toISOString() }),
        });
    }

    async markMerged(name: string, prNumber?: number): Promise<void> {
        const payload: Record<string, unknown> = { state: 'merged', updated_at: new Date().toISOString() };
        if (prNumber) {
            payload.pr_number = prNumber;
        }

        await this.fetchFromSupabase(`branch_registry?branch_name=eq.${encodeURIComponent(name)}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
        });
    }

    async getStale(): Promise<Branch[]> {
        const response = await this.fetchFromSupabase('stale_branches?select=*');
        if (!response.ok) {
            throw new Error(`Failed to get stale: ${await response.text()}`);
        }

        const rows = await response.json() as SupabaseBranchRow[];
        return rows.map((row) => this.rowToBranch(row));
    }

    async getRaw(name: string): Promise<SupabaseBranchRow | null> {
        const response = await this.fetchFromSupabase(
            `branch_registry?branch_name=eq.${encodeURIComponent(name)}&limit=1`,
        );
        if (!response.ok) {
            return null;
        }

        const rows = await response.json() as SupabaseBranchRow[];
        return rows[0] || null;
    }

    async pushGitHubBranches(rows: unknown[]): Promise<number> {
        const response = await this.fetchFromSupabase('spider_github_branches', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify(rows),
        });

        if (!response.ok) {
            const message = await response.text();
            if (message.includes('does not exist') || message.includes('42P01')) {
                return 0;
            }
            throw new Error(`pushGitHubBranches failed: ${message}`);
        }

        return rows.length;
    }

    async init(): Promise<void> {
        if (!this.url || !this.key) {
            throw new Error('Supabase URL and key required. Set SUPABASE_URL and SUPABASE_KEY env vars.');
        }

        const response = await this.fetchFromSupabase('branch_registry?select=id&limit=1');
        if (!response.ok) {
            throw new Error(`Failed to connect to Supabase: ${await response.text()}`);
        }
    }

    async isInitialized(): Promise<boolean> {
        try {
            await this.init();
            return true;
        } catch {
            return false;
        }
    }

    private rowToBranch(row: SupabaseBranchRow): Branch {
        return {
            name: row.branch_name,
            files: row.files_changed || [],
            registeredAt: new Date(row.created_at),
            agent: row.created_by_agent || undefined,
            status: row.state === 'active'
                ? 'active'
                : row.state === 'merged'
                    ? 'completed'
                    : 'abandoned',
            description: row.description || undefined,
        };
    }

    private async fetchFromSupabase(endpoint: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.url}/rest/v1/${endpoint}`;

        try {
            const response = await this.fetchFn(url, {
                ...options,
                headers: {
                    apikey: this.key,
                    Authorization: `Bearer ${this.key}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation',
                    ...options.headers,
                },
            });

            if (!response.ok) {
                const text = await response.text();
                let parsed: { message?: string } = {};
                try {
                    parsed = JSON.parse(text) as { message?: string };
                } catch {
                    // ignore parse failures for non-JSON error bodies
                }

                if (parsed.message?.includes('Invalid API key')) {
                    throw new Error(
                        'Invalid Supabase API key.\n' +
                        '  Hint: Check your SUPABASE_KEY environment variable.\n' +
                        '  Note: A local .env file may be overriding your mycmail config.',
                    );
                }

                if (response.status === 401 || response.status === 403) {
                    throw new Error(
                        'Supabase authentication failed.\n' +
                        '  • Check SUPABASE_URL and SUPABASE_KEY are correct\n' +
                        '  • Verify RLS policies allow access\n' +
                        '  • Check for .env conflicts in current directory',
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
                    '  • Verify SUPABASE_URL is correct',
                );
            }

            throw error;
        }
    }
}
