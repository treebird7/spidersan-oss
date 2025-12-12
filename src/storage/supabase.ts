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

// Message types matching the database schema
export type MessageType = 'info' | 'question' | 'alert' | 'handoff' | 'file_share';

export interface AgentMessage {
    id: string;
    fromAgent: string;
    toAgent: string;
    fromRepo?: string;
    toRepo?: string;
    subject: string;
    message: string;
    messageType: MessageType;
    branchName?: string;
    relatedFiles?: string[];
    attachedFiles?: Record<string, unknown>;
    read: boolean;
    readAt?: Date;
    repliedTo?: string;
    createdAt: Date;
}

interface SupabaseMessageRow {
    id: string;
    from_agent: string;
    to_agent: string;
    from_repo: string | null;
    to_repo: string | null;
    subject: string;
    message: string;
    message_type: string;
    branch_name: string | null;
    related_files: string[] | null;
    attached_files: Record<string, unknown> | null;
    read: boolean;
    read_at: string | null;
    replied_to: string | null;
    created_at: string;
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

    // ═══════════════════════════════════════════════════════════════
    // Agent Messaging Methods
    // ═══════════════════════════════════════════════════════════════

    private rowToMessage(row: SupabaseMessageRow): AgentMessage {
        return {
            id: row.id,
            fromAgent: row.from_agent,
            toAgent: row.to_agent,
            fromRepo: row.from_repo || undefined,
            toRepo: row.to_repo || undefined,
            subject: row.subject,
            message: row.message,
            messageType: row.message_type as MessageType,
            branchName: row.branch_name || undefined,
            relatedFiles: row.related_files || undefined,
            attachedFiles: row.attached_files || undefined,
            read: row.read,
            readAt: row.read_at ? new Date(row.read_at) : undefined,
            repliedTo: row.replied_to || undefined,
            createdAt: new Date(row.created_at),
        };
    }

    async sendMessage(options: {
        fromAgent: string;
        toAgent: string;
        subject: string;
        message: string;
        messageType?: MessageType;
        fromRepo?: string;
        toRepo?: string;
        branchName?: string;
        relatedFiles?: string[];
        attachedFiles?: Record<string, unknown>;
        replyTo?: string;
    }): Promise<AgentMessage> {
        const payload = {
            from_agent: options.fromAgent,
            to_agent: options.toAgent,
            subject: options.subject,
            message: options.message,
            message_type: options.messageType || 'info',
            from_repo: options.fromRepo || null,
            to_repo: options.toRepo || null,
            branch_name: options.branchName || null,
            related_files: options.relatedFiles || null,
            attached_files: options.attachedFiles || null,
            replied_to: options.replyTo || null,
        };

        const response = await this.fetch('agent_messages', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Failed to send message: ${await response.text()}`);
        }

        const [row] = await response.json() as SupabaseMessageRow[];
        return this.rowToMessage(row);
    }

    async getInbox(agentId: string, options?: { unreadOnly?: boolean; limit?: number }): Promise<AgentMessage[]> {
        let endpoint = `agent_messages?to_agent=eq.${encodeURIComponent(agentId)}`;
        if (options?.unreadOnly) {
            endpoint += '&read=eq.false';
        }
        endpoint += '&order=created_at.desc';
        if (options?.limit) {
            endpoint += `&limit=${options.limit}`;
        }

        const response = await this.fetch(endpoint);
        if (!response.ok) throw new Error(`Failed to get inbox: ${await response.text()}`);

        const rows = await response.json() as SupabaseMessageRow[];
        return rows.map(r => this.rowToMessage(r));
    }

    async getSentMessages(agentId: string, options?: { limit?: number }): Promise<AgentMessage[]> {
        let endpoint = `agent_messages?from_agent=eq.${encodeURIComponent(agentId)}&order=created_at.desc`;
        if (options?.limit) {
            endpoint += `&limit=${options.limit}`;
        }

        const response = await this.fetch(endpoint);
        if (!response.ok) throw new Error(`Failed to get sent messages: ${await response.text()}`);

        const rows = await response.json() as SupabaseMessageRow[];
        return rows.map(r => this.rowToMessage(r));
    }

    async getMessage(messageId: string): Promise<AgentMessage | null> {
        const response = await this.fetch(`agent_messages?id=eq.${encodeURIComponent(messageId)}&limit=1`);
        if (!response.ok) throw new Error(`Failed to get message: ${await response.text()}`);

        const rows = await response.json() as SupabaseMessageRow[];
        return rows.length > 0 ? this.rowToMessage(rows[0]) : null;
    }

    async markMessageRead(messageId: string): Promise<boolean> {
        const response = await this.fetch(`agent_messages?id=eq.${encodeURIComponent(messageId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ read: true, read_at: new Date().toISOString() }),
        });

        if (!response.ok) throw new Error(`Failed to mark message read: ${await response.text()}`);
        const rows = await response.json() as SupabaseMessageRow[];
        return rows.length > 0;
    }

    async getUnreadCount(agentId: string): Promise<number> {
        const response = await this.fetch(
            `agent_messages?to_agent=eq.${encodeURIComponent(agentId)}&read=eq.false&select=id`,
            { headers: { 'Prefer': 'count=exact' } }
        );
        if (!response.ok) throw new Error(`Failed to get unread count: ${await response.text()}`);

        const rows = await response.json() as { id: string }[];
        return rows.length;
    }
}
