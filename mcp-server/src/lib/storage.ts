/**
 * Spidersan Storage Adapter for MCP
 * 
 * Interfaces with the main Spidersan registry.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

// Registry file in current working directory
const REGISTRY_DIR = '.spidersan';
const REGISTRY_FILE = 'registry.json';

export interface Branch {
    name: string;
    files: string[];
    status: 'active' | 'merged' | 'abandoned' | 'stale';
    description?: string;
    agent?: string;
    dependencies?: string[];
    registeredAt: string;
    updatedAt: string;
}

export interface Registry {
    version: number;
    branches: Branch[];
    updatedAt: string;
}

/**
 * Get the path to the registry file
 */
function getRegistryPath(): string {
    return join(process.cwd(), REGISTRY_DIR, REGISTRY_FILE);
}

/**
 * Check if Spidersan is initialized in this directory
 */
export function isInitialized(): boolean {
    return existsSync(getRegistryPath());
}

/**
 * Load the registry
 */
export function loadRegistry(): Registry | null {
    const path = getRegistryPath();
    if (!existsSync(path)) return null;

    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return null;
    }
}

/**
 * Save the registry
 */
function saveRegistry(registry: Registry): void {
    const dir = join(process.cwd(), REGISTRY_DIR);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2));
}

/**
 * Get all branches
 */
export function listBranches(): Branch[] {
    const registry = loadRegistry();
    return registry?.branches || [];
}

/**
 * Get active branches only
 */
export function listActiveBranches(): Branch[] {
    return listBranches().filter(b => b.status === 'active');
}

/**
 * Get a specific branch
 */
export function getBranch(name: string): Branch | null {
    const branches = listBranches();
    return branches.find(b => b.name === name) || null;
}

/**
 * Get current git branch
 */
export function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

/**
 * Register or update a branch
 */
export function registerBranch(branch: Omit<Branch, 'registeredAt' | 'updatedAt'>): Branch {
    const registry = loadRegistry() || { version: 1, branches: [], updatedAt: '' };
    const now = new Date().toISOString();

    const existing = registry.branches.findIndex(b => b.name === branch.name);
    const fullBranch: Branch = {
        ...branch,
        registeredAt: existing >= 0 ? registry.branches[existing].registeredAt : now,
        updatedAt: now,
    };

    if (existing >= 0) {
        registry.branches[existing] = fullBranch;
    } else {
        registry.branches.push(fullBranch);
    }

    registry.updatedAt = now;
    saveRegistry(registry);

    return fullBranch;
}

/**
 * Update branch status
 */
export function updateBranchStatus(name: string, status: Branch['status']): boolean {
    const registry = loadRegistry();
    if (!registry) return false;

    const branch = registry.branches.find(b => b.name === name);
    if (!branch) return false;

    branch.status = status;
    branch.updatedAt = new Date().toISOString();
    registry.updatedAt = new Date().toISOString();

    saveRegistry(registry);
    return true;
}

/**
 * Find file conflicts between active branches
 */
export function findConflicts(): Array<{ file: string; branches: string[] }> {
    const branches = listActiveBranches();
    const fileMap = new Map<string, string[]>();

    for (const branch of branches) {
        for (const file of branch.files) {
            const existing = fileMap.get(file) || [];
            existing.push(branch.name);
            fileMap.set(file, existing);
        }
    }

    const conflicts: Array<{ file: string; branches: string[] }> = [];
    for (const [file, branchList] of fileMap.entries()) {
        if (branchList.length > 1) {
            conflicts.push({ file, branches: branchList });
        }
    }

    return conflicts;
}

/**
 * Get optimal merge order based on dependencies
 */
export function getMergeOrder(): string[] {
    const branches = listActiveBranches();
    const visited = new Set<string>();
    const result: string[] = [];

    function visit(name: string) {
        if (visited.has(name)) return;
        visited.add(name);

        const branch = branches.find(b => b.name === name);
        if (!branch) return;

        for (const dep of branch.dependencies || []) {
            visit(dep);
        }

        result.push(name);
    }

    for (const branch of branches) {
        visit(branch.name);
    }

    return result;
}
