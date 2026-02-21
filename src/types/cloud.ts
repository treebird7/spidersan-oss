/**
 * Cloud Types — Shared interfaces for Supabase cross-machine sync
 * 
 * These types define the contract between:
 * - F1 (Registry Sync) — storage adapter
 * - F2 (GitHub Branch Inventory) — branch data
 * - F3 (Cross-Machine Conflicts) — conflict detection
 * - F5 (TUI Dashboard) — display layer
 * 
 * Both m2 and i7 instances code against these interfaces.
 */

// ─── Machine Identity (from ~/.envoak/machine.json) ───

export interface MachineIdentity {
    id: string;          // UUID from envoak
    name: string;        // e.g. "m2", "i7"
    hostname: string;    // e.g. "Mac.lan"
}

// ─── Spider Registry (F1: Supabase table) ───

export interface SpiderRegistry {
    id: string;                          // UUID (Supabase auto-generated)
    machine_id: string;                  // from envoak machine.json
    machine_name: string;                // e.g. "m2"
    hostname: string;                    // e.g. "Mac.lan"
    repo_path: string;                   // e.g. "/Users/freedbird/Dev/spidersan"
    repo_name: string;                   // e.g. "spidersan"
    branch_name: string;
    files: string[];
    agent: string | null;
    description: string | null;
    status: 'active' | 'completed' | 'abandoned' | 'merged';
    last_commit_sha: string | null;
    last_commit_date: string | null;     // ISO 8601
    synced_at: string;                   // ISO 8601
    created_at: string;                  // ISO 8601
}

// ─── GitHub Branch Inventory (F2: Supabase table) ───

export interface SpiderGitHubBranch {
    id: string;                          // UUID
    repo_owner: string;                  // e.g. "birdtreedev"
    repo_name: string;                   // e.g. "spidersan"
    branch_name: string;
    author: string;                      // last commit author
    last_commit_sha: string;
    last_commit_date: string;            // ISO 8601
    ahead_behind: {
        ahead: number;
        behind: number;
    };
    pr_number: number | null;
    pr_status: 'open' | 'closed' | 'merged' | null;
    is_default: boolean;
    scanned_at: string;                  // ISO 8601
    scanned_by_machine: string;          // machine_id that ran the scan
}

// ─── Registry Sync Operations ───

export interface RegistrySyncResult {
    pushed: number;
    updated: number;
    abandoned: number;                   // local branches removed → marked abandoned
    errors: string[];
}

export interface MachineRegistryView {
    machine_id: string;
    machine_name: string;
    hostname: string;
    repo_name: string;                   // e.g. "spidersan"
    repo_path: string;                   // e.g. "/Users/freedbird/Dev/spidersan"
    branches: import('../storage/adapter.js').Branch[];
    last_synced: string;                 // ISO 8601
}

export interface RegistryStatus {
    machine_id: string;
    machine_name: string;
    hostname: string;
    branch_count: number;
    active_count: number;
    last_sync: string;
    repos: string[];
}

// ─── Cross-Machine Conflict (F3) ───

export interface CrossMachineConflict {
    file: string;
    tier: 1 | 2 | 3;
    branches: Array<{
        branch_name: string;
        machine_id: string;
        machine_name: string;
        agent: string | null;
    }>;
}

export interface GlobalConflictReport {
    conflicts: CrossMachineConflict[];
    machines_scanned: number;
    total_branches: number;
    scan_time: string;                   // ISO 8601
}

// ─── Sync Advisor (F4) ───

export type SyncAction = 'push' | 'pull' | 'rebase' | 'conflict' | 'up-to-date';

export interface SyncRecommendation {
    repo_name: string;
    branch_name: string;
    machine_name: string;
    action: SyncAction;
    reason: string;
    priority: 'high' | 'medium' | 'low';
}
