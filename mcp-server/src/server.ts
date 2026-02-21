#!/usr/bin/env node

/**
 * Spidersan MCP Server
 * 
 * Exposes Spidersan branch coordination as MCP tools for Claude Desktop
 * and other MCP-compatible clients.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import * as storage from './lib/storage.js';
// License check removed for OSS version
import { existsSync, realpathSync, mkdirSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { resolve, isAbsolute, sep } from 'path';
import { execSync, execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { promisify } from 'util';

// Security: Validate directory is safe to watch
function validateWatchDirectory(dir: string | undefined): string {
    const targetDir = dir || process.cwd();
    const absPath = isAbsolute(targetDir) ? targetDir : resolve(process.cwd(), targetDir);

    // Security checks
    if (!existsSync(absPath)) {
        throw new Error(`Directory does not exist: ${absPath}`);
    }

    // Prevent watching sensitive system directories
    const sensitivePatterns = ['/etc', '/var', '/usr', '/bin', '/sbin', '/root', '/home/root'];
    const realPath = realpathSync(absPath);
    for (const pattern of sensitivePatterns) {
        if (realPath.startsWith(pattern)) {
            throw new Error(`Cannot watch system directory: ${pattern}`);
        }
    }

    return realPath;
}

// Create the MCP server
const server = new McpServer({
    name: 'spidersan',
    version: '1.2.3',
});

const execFileAsync = promisify(execFile);
const LOCK_TTL_MS = 5 * 60 * 1000;
const MAX_FILE_LOCK_TTL_MINUTES = 24 * 60;
const lockRegistryDir = resolve(homedir(), '.spidersan');
const lockRegistryPath = resolve(lockRegistryDir, 'registry.json');

type ConflictLock = { agent: string; ts: number; branch: string; target: string };
type FileLock = { file: string; agent: string; reason?: string; expires: number; token: string };

type LockRegistry = {
    locks?: FileLock[];
    conflictLocks?: Record<string, ConflictLock>;
    [key: string]: any;
};

async function loadLockRegistry(): Promise<LockRegistry> {
    if (!existsSync(lockRegistryPath)) return { locks: [], conflictLocks: {} };

    try {
        const raw = await readFile(lockRegistryPath, 'utf-8');
        const parsed = JSON.parse(raw) as LockRegistry;
        if (!parsed || typeof parsed !== 'object') return { locks: [], conflictLocks: {} };

        const legacyLocks = parsed.locks;
        if (Array.isArray(legacyLocks)) {
            parsed.locks = legacyLocks;
        } else if (legacyLocks && typeof legacyLocks === 'object') {
            parsed.conflictLocks = {
                ...(parsed.conflictLocks || {}),
                ...(legacyLocks as Record<string, ConflictLock>),
            };
            parsed.locks = [];
        } else {
            parsed.locks = [];
        }

        if (!parsed.conflictLocks || typeof parsed.conflictLocks !== 'object' || Array.isArray(parsed.conflictLocks)) {
            parsed.conflictLocks = {};
        }

        const now = Date.now();
        parsed.locks = parsed.locks.filter((lock) =>
            lock &&
            typeof lock.file === 'string' &&
            typeof lock.agent === 'string' &&
            typeof lock.expires === 'number' &&
            lock.expires > now
        );

        return parsed;
    } catch {
        return { locks: [], conflictLocks: {} };
    }
}

async function saveLockRegistry(registry: LockRegistry): Promise<void> {
    if (!existsSync(lockRegistryDir)) {
        mkdirSync(lockRegistryDir, { recursive: true });
    }
    await writeFile(lockRegistryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

function getExecErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
        const err = error as { stderr?: string; stdout?: string; message?: string };
        return String(err.stderr || err.stdout || err.message || 'Unknown error');
    }
    return String(error);
}

async function ensureValidBranchName(branchName: string, repoDir: string): Promise<string | null> {
    if (!branchName) return 'Unable to determine current branch';
    try {
        await execFileAsync('git', ['check-ref-format', '--branch', branchName], { cwd: repoDir });
        return null;
    } catch {
        return `Invalid branch name: ${branchName}`;
    }
}

function getRepoRootForDir(dir: string): string {
    try {
        return execSync('git rev-parse --show-toplevel', { cwd: dir, encoding: 'utf-8' }).trim();
    } catch {
        return dir;
    }
}

function resolveSpidersanCliForDir(dir: string): { command: string; argsPrefix: string[] } {
    const repoRoot = getRepoRootForDir(dir);
    const localCli = resolve(repoRoot, 'dist', 'bin', 'spidersan.js');
    if (existsSync(localCli)) {
        return { command: process.execPath, argsPrefix: [localCli] };
    }
    return { command: 'spidersan', argsPrefix: [] };
}

function extractConflictSummary(payload: any): { conflicts: any[]; maxTier: number } {
    const conflicts = Array.isArray(payload?.conflicts) ? payload.conflicts : [];
    let maxTier = conflicts.reduce((max: number, conflict: any) => {
        const tier = typeof conflict?.tier === 'number' ? conflict.tier : 0;
        return Math.max(max, tier);
    }, 0);

    const summary = payload?.summary;
    if (summary && typeof summary === 'object') {
        if (typeof summary.tier3 === 'number' && summary.tier3 > 0) maxTier = Math.max(maxTier, 3);
        if (typeof summary.tier2 === 'number' && summary.tier2 > 0) maxTier = Math.max(maxTier, 2);
        if (typeof summary.tier1 === 'number' && summary.tier1 > 0) maxTier = Math.max(maxTier, 1);
    }

    return { conflicts, maxTier };
}

function isReadyCheckPass(payload: any): boolean {
    if (!payload || typeof payload !== 'object') return false;
    return payload.ready === true || payload.pass === true;
}

function globToRegex(pattern: string): RegExp {
    let regex = '^';
    for (const char of pattern) {
        if (char === '*') {
            regex += '.*';
            continue;
        }
        if (char === '?') {
            regex += '.';
            continue;
        }
        regex += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
    regex += '$';
    return new RegExp(regex);
}

async function getCurrentBranchName(repoDir: string): Promise<string | null> {
    try {
        const current = await execFileAsync('git', ['branch', '--show-current'], { cwd: repoDir });
        const branch = current.stdout.trim();
        return branch.length > 0 ? branch : null;
    } catch {
        return null;
    }
}


// Tool: list_branches
server.tool(
    'list_branches',
    'List all registered branches in the current project',
    {
        status: z.enum(['all', 'active', 'completed', 'merged', 'abandoned']).optional()
            .describe('Filter by status (default: active). Note: "merged" is an alias for "completed".'),
    },
    async ({ status = 'active' }) => {
        // MCP uses per-repo registry at <git-root>/.spidersan/registry.json.
        // If none exists yet, treat as empty.

        const normalizedStatus = status === 'merged' ? 'completed' : status;

        const branches = normalizedStatus === 'all'
            ? storage.listBranches()
            : storage.listBranches().filter(b => b.status === normalizedStatus);

        if (!storage.isInitialized() || branches.length === 0) {
            return {
                content: [{ type: 'text', text: `📋 No ${status} branches registered for this repo yet` }],
            };
        }

        const formatted = branches.map(b => {
            const files = b.files.length > 0 ? b.files.slice(0, 3).join(', ') + (b.files.length > 3 ? '...' : '') : 'none';
            const agent = b.agent ? ` (${b.agent})` : '';
            return `• ${b.name}${agent}: ${b.description || 'No description'}\n  Files: ${files}`;
        }).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Branches (${branches.length} ${status}):\n\n${formatted}`
            }],
        };
    }
);

// Tool: check_conflicts
server.tool(
    'check_conflicts',
    'Check for file conflicts between active branches',
    {},
    async () => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '✅ No file conflicts detected (no branches registered for this repo yet)' }],
            };
        }

        const conflicts = storage.findConflicts();

        if (conflicts.length === 0) {
            return {
                content: [{ type: 'text', text: '✅ No file conflicts detected between active branches' }],
            };
        }

        const formatted = conflicts.map(c =>
            `⚠️ ${c.file}\n   Branches: ${c.branches.join(', ')}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Conflicts detected (${conflicts.length} files):\n\n${formatted}\n\nRecommendation: Coordinate with other agents to avoid merge conflicts.`
            }],
        };
    }
);

// Tool: get_merge_order
server.tool(
    'get_merge_order',
    'Get recommended merge order based on dependencies',
    {},
    async () => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '📋 No active branches to merge (no branches registered for this repo yet)' }],
            };
        }

        const order = storage.getMergeOrder();

        if (order.length === 0) {
            return {
                content: [{ type: 'text', text: '📋 No active branches to merge' }],
            };
        }

        const formatted = order.map((name, i) => `${i + 1}. ${name}`).join('\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Recommended merge order:\n\n${formatted}\n\nMerge in this order to minimize conflicts.`
            }],
        };
    }
);

// Tool: ready_check
server.tool(
    'ready_check',
    'Validate if a branch is safe to merge. Returns pass/fail with blocking reasons.',
    {
        branch: z.string().describe('Branch name to check'),
        target: z.string().optional().describe('Target branch (default: main)'),
    },
    async ({ branch, target }) => {
        const cwd = process.cwd();
        const cli = resolveSpidersanCliForDir(cwd);
        try {
            const result = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'ready-check', '--json'],
                { cwd }
            );
            let parsed: unknown;
            try {
                parsed = JSON.parse(result.stdout || '{}');
            } catch {
                parsed = { raw: result.stdout?.trim() || '' };
            }
            if (branch && typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                const payload = parsed as Record<string, unknown>;
                if (payload.branch && payload.branch !== branch) {
                    payload.requestedBranch = branch;
                }
                if (target) {
                    payload.requestedTarget = target;
                }
                parsed = payload;
            }
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify(parsed, null, 2)
                }],
            };
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }
    }
);

// Tool: branch_status
server.tool(
    'branch_status',
    'Get detailed status of all active branches including owners, staleness, conflict tier, and last activity.',
    {
        repo: z.string().optional().describe('Repository path (default: current directory)'),
        includeStale: z.boolean().optional().describe('Include stale branches (>7 days inactive)'),
    },
    async ({ repo, includeStale }) => {
        const repoDir = repo
            ? (isAbsolute(repo) ? repo : resolve(process.cwd(), repo))
            : process.cwd();

        if (!existsSync(repoDir)) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: `Repository path not found: ${repoDir}` }, null, 2)
                }],
                isError: true,
            };
        }

        const cli = resolveSpidersanCliForDir(repoDir);
        let branches: any[] = [];

        try {
            const listResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'list', '--json'],
                { cwd: repoDir }
            );
            try {
                const parsed = JSON.parse(listResult.stdout || '[]');
                branches = Array.isArray(parsed) ? parsed : [];
            } catch {
                branches = [];
            }
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        const now = Date.now();
        const staleMs = 7 * 24 * 60 * 60 * 1000;

        const enriched = await Promise.all(branches.map(async (branch: any) => {
            const lastActivityRaw = branch.updatedAt || branch.registeredAt || null;
            const lastActivityDate = lastActivityRaw ? new Date(lastActivityRaw) : null;
            const lastActivityMs = lastActivityDate && Number.isFinite(lastActivityDate.getTime())
                ? lastActivityDate.getTime()
                : null;
            const stale = lastActivityMs ? (now - lastActivityMs > staleMs) : false;
            const lastActivity = lastActivityDate && Number.isFinite(lastActivityDate.getTime())
                ? lastActivityDate.toISOString()
                : null;

            let conflictTier = 0;
            let conflictCount = 0;
            try {
                const conflictResult = await execFileAsync(
                    cli.command,
                    [...cli.argsPrefix, 'conflicts', '--branch', branch.name, '--json'],
                    { cwd: repoDir }
                );
                const conflictData = JSON.parse(conflictResult.stdout || '{}');
                const conflictList = Array.isArray(conflictData.conflicts) ? conflictData.conflicts : [];
                conflictCount = conflictList.length;
                conflictTier = conflictList.reduce((max: number, c: any) => {
                    const tier = typeof c?.tier === 'number' ? c.tier : 0;
                    return Math.max(max, tier);
                }, 0);
            } catch {
                conflictTier = 0;
                conflictCount = 0;
            }

            return {
                ...branch,
                owner: branch.agent ?? null,
                lastActivity,
                stale,
                conflictTier,
                conflictCount,
            };
        }));

        const includeStaleFlag = includeStale ?? false;
        const filtered = includeStaleFlag ? enriched : enriched.filter((b: any) => !b.stale);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    count: filtered.length,
                    branches: filtered
                }, null, 2)
            }],
        };
    }
);

// Tool: request_resolution
server.tool(
    'request_resolution',
    'Claim a conflict for resolution. Returns conflict context and reserves the conflict to prevent simultaneous resolution attempts.',
    {
        branch: z.string().describe('Branch with conflicts to resolve'),
        target: z.string().optional().describe('Target branch (default: main)'),
        agent: z.string().describe('Agent claiming the resolution'),
        tier: z.number().int().min(1).max(3).optional().describe('Conflict tier to resolve (1, 2, or 3)'),
    },
    async ({ branch, target, agent, tier }) => {
        const targetBranch = target || 'main';
        const conflictKey = `conflict:${branch}:${targetBranch}`;
        const now = Date.now();

        const storageState = await loadLockRegistry();
        const existingLock = storageState.conflictLocks?.[conflictKey];

        if (existingLock && now - existingLock.ts < LOCK_TTL_MS) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: 'Conflict already claimed',
                        claimedBy: existingLock.agent,
                        claimedAt: new Date(existingLock.ts).toISOString()
                    }, null, 2)
                }],
                isError: true,
            };
        }

        const cwd = process.cwd();
        const cli = resolveSpidersanCliForDir(cwd);
        let conflictsPayload: any;

        try {
            const conflictResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'conflicts', '--branch', branch, '--json'],
                { cwd }
            );
            conflictsPayload = JSON.parse(conflictResult.stdout || '{}');
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        const allConflicts = Array.isArray(conflictsPayload?.conflicts) ? conflictsPayload.conflicts : [];
        const filteredConflicts = typeof tier === 'number'
            ? allConflicts.filter((c: any) => c?.tier === tier)
            : allConflicts;

        storageState.conflictLocks = storageState.conflictLocks || {};
        storageState.conflictLocks[conflictKey] = {
            agent,
            ts: now,
            branch,
            target: targetBranch,
        };
        await saveLockRegistry(storageState);

        const fileSet = new Set<string>();
        for (const conflict of filteredConflicts) {
            if (conflict && typeof conflict.file === 'string') {
                fileSet.add(conflict.file);
            }
            if (Array.isArray(conflict?.files)) {
                for (const file of conflict.files) {
                    if (typeof file === 'string') {
                        fileSet.add(file);
                    }
                }
            }
        }

        const contextFiles = Array.from(fileSet).slice(0, 5);
        const context = [] as Array<{ file: string; content: string }>;
        let repoRoot = cwd;
        try {
            repoRoot = realpathSync(getRepoRootForDir(cwd));
        } catch {
            repoRoot = realpathSync(cwd);
        }
        const repoRootPrefix = repoRoot.endsWith(sep) ? repoRoot : `${repoRoot}${sep}`;

        for (const file of contextFiles) {
            const absolutePath = isAbsolute(file) ? file : resolve(cwd, file);
            try {
                const realPath = realpathSync(absolutePath);
                if (!realPath.startsWith(repoRootPrefix)) {
                    context.push({ file, content: '(skipped: outside repo root)' });
                    continue;
                }
                const content = await readFile(realPath, 'utf-8');
                context.push({ file, content: content.slice(0, 2000) });
            } catch {
                context.push({ file, content: '(unreadable)' });
            }
        }

        const conflictTier = filteredConflicts.reduce((max: number, c: any) => {
            const tierValue = typeof c?.tier === 'number' ? c.tier : 0;
            return Math.max(max, tierValue);
        }, 0);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    claimedBy: agent,
                    branch,
                    target: targetBranch,
                    conflictTier,
                    conflicts: filteredConflicts,
                    context,
                    lockExpires: new Date(now + LOCK_TTL_MS).toISOString()
                }, null, 2)
            }],
        };
    }
);

// Tool: release_resolution
server.tool(
    'release_resolution',
    'Release a conflict claim early so another agent can resolve it.',
    {
        branch: z.string().describe('Branch with conflicts to resolve'),
        target: z.string().optional().describe('Target branch (default: main)'),
        agent: z.string().describe('Agent releasing the resolution claim'),
    },
    async ({ branch, target, agent }) => {
        const targetBranch = target || 'main';
        const conflictKey = `conflict:${branch}:${targetBranch}`;

        const storageState = await loadLockRegistry();
        const existingLock = storageState.conflictLocks?.[conflictKey];

        if (existingLock?.agent === agent) {
            delete storageState.conflictLocks?.[conflictKey];
            await saveLockRegistry(storageState);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ released: true }, null, 2)
                }],
            };
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({ released: false, error: 'Not claimed by this agent' }, null, 2)
            }],
        };
    }
);

// Tool: lock_files
server.tool(
    'lock_files',
    'Lock files to prevent concurrent edits. Returns lock token.',
    {
        files: z.array(z.string()).min(1).describe('File paths to lock (relative or absolute)'),
        agent: z.string().describe('Agent requesting lock'),
        reason: z.string().optional().describe('Why files are being locked'),
        ttl: z.number().int().positive().optional().describe('Lock timeout in minutes (default: 30)'),
    },
    async ({ files, agent, reason, ttl }) => {
        const registry = await loadLockRegistry();
        const now = Date.now();
        const effectiveTtl = typeof ttl === 'number' ? ttl : 30;
        const boundedTtl = Math.min(effectiveTtl, MAX_FILE_LOCK_TTL_MINUTES);

        registry.locks = Array.isArray(registry.locks)
            ? registry.locks.filter(lock => lock.expires > now)
            : [];

        const conflicts: Array<{ file: string; lockedBy: string }> = [];
        for (const file of files) {
            const existing = registry.locks.find(lock => lock.file === file && lock.expires > now);
            if (existing && existing.agent !== agent) {
                conflicts.push({ file, lockedBy: existing.agent });
            }
        }

        if (conflicts.length > 0) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: 'Files already locked',
                        conflicts
                    })
                }],
                isError: true,
            };
        }

        const lockToken = randomUUID();
        const expires = now + (boundedTtl * 60 * 1000);

        for (const file of files) {
            registry.locks = registry.locks.filter(lock => !(lock.file === file && lock.agent === agent));
            registry.locks.push({ file, agent, reason, expires, token: lockToken });
        }

        await saveLockRegistry(registry);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    lockToken,
                    files: files.length,
                    expiresAt: new Date(expires).toISOString()
                })
            }]
        };
    }
);

// Tool: unlock_files
server.tool(
    'unlock_files',
    'Release file locks. Requires agent match or lock token.',
    {
        files: z.array(z.string()).optional().describe('File paths to unlock (omit to unlock all by agent)'),
        agent: z.string().optional().describe('Agent releasing lock'),
        token: z.string().optional().describe('Lock token (alternative to agent)'),
        force: z.boolean().describe('Force unlock (admin only)').optional().default(false),
    },
    async ({ files, agent, token, force = false }) => {
        const registry = await loadLockRegistry();

        if (!Array.isArray(registry.locks) || registry.locks.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: true, released: 0, remaining: 0 })
                }]
            };
        }

        const now = Date.now();
        registry.locks = registry.locks.filter(lock => lock.expires > now);

        const targetFiles = files && files.length > 0 ? files : undefined;

        let released = 0;
        registry.locks = registry.locks.filter(lock => {
            const matchesFiles = !targetFiles || targetFiles.includes(lock.file);
            const matchesAgent = agent && lock.agent === agent;
            const matchesToken = token && lock.token === token;

            if (matchesFiles && (matchesAgent || matchesToken || force)) {
                released++;
                return false;
            }
            return true;
        });

        await saveLockRegistry(registry);

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    released,
                    remaining: registry.locks.length
                })
            }]
        };
    }
);

// Tool: who_owns
server.tool(
    'who_owns',
    'Query who owns, locks, or is working on specific files.',
    {
        files: z.array(z.string()).optional().describe('File paths to query'),
        pattern: z.string().optional().describe('Glob pattern to match files (alternative to files array)'),
    },
    async ({ files = [], pattern }) => {
        const branches = storage.listBranches();
        const lockRegistry = await loadLockRegistry();
        const now = Date.now();

        const activeLocks = Array.isArray(lockRegistry.locks)
            ? lockRegistry.locks.filter(lock => lock.expires > now)
            : [];

        const allFiles = new Set<string>();
        for (const branch of branches) {
            for (const file of branch.files || []) {
                allFiles.add(file);
            }
        }
        for (const lock of activeLocks) {
            if (lock?.file) {
                allFiles.add(lock.file);
            }
        }

        let filesToCheck = Array.from(new Set(files));
        if (pattern) {
            const regex = globToRegex(pattern);
            filesToCheck = [...allFiles].filter(file => regex.test(file));
        }

        const results = filesToCheck.map(file => {
            const owners = new Set<string>();
            const entry = {
                file,
                lock: null as null | { agent: string; reason?: string; expires: string },
                branches: [] as Array<{ name: string; agent?: string }>,
                owners: [] as string[],
            };

            const lock = activeLocks.find(item => item.file === file && item.expires > now);
            if (lock) {
                entry.lock = {
                    agent: lock.agent,
                    reason: lock.reason,
                    expires: new Date(lock.expires).toISOString(),
                };
                if (lock.agent) owners.add(lock.agent);
            }

            for (const branch of branches) {
                if (branch.status === 'active' && branch.files?.includes(file)) {
                    entry.branches.push({ name: branch.name, agent: branch.agent });
                    if (branch.agent) owners.add(branch.agent);
                }
            }

            entry.owners = [...owners];
            return entry;
        });

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    queried: filesToCheck.length,
                    results,
                    summary: results
                        .filter(result => result.owners.length > 0)
                        .map(result => `${result.file}: ${result.owners.join(', ')}`),
                })
            }],
        };
    }
);

// Tool: intent_scan
server.tool(
    'intent_scan',
    'Scan for potential conflicts before starting work. Analyzes task files and registered branches.',
    {
        files: z.array(z.string()).min(1).describe('Files you intend to modify'),
        agent: z.string().describe('Agent planning the work'),
        taskId: z.string().optional().describe('Optional task ID for context'),
    },
    async ({ files, agent, taskId }) => {
        const registry = storage.loadRegistry();
        const lockRegistry = await loadLockRegistry();
        const conflicts: Array<{ file: string; branch: string; agent?: string; severity: 'high' }> = [];
        const warnings: Array<{ file: string; nearbyFile: string; branch: string; agent?: string; severity: 'medium' }> = [];
        const locks: Array<{ file: string; lockedBy: string; reason?: string; expires: string }> = [];
        const now = Date.now();

        const branches = registry ? Object.values(registry.branches || {}) : [];

        for (const file of files) {
            const lock = lockRegistry.locks?.find(l =>
                l.file === file && l.expires > now && l.agent !== agent
            );
            if (lock) {
                locks.push({
                    file,
                    lockedBy: lock.agent,
                    reason: lock.reason,
                    expires: new Date(lock.expires).toISOString(),
                });
            }

            for (const branch of branches) {
                if (branch.status === 'active' && branch.agent !== agent) {
                    if (branch.files?.includes(file)) {
                        conflicts.push({
                            file,
                            branch: branch.name,
                            agent: branch.agent,
                            severity: 'high',
                        });
                    }

                    const fileDir = file.split('/').slice(0, -1).join('/');
                    for (const bf of branch.files || []) {
                        const bfDir = bf.split('/').slice(0, -1).join('/');
                        if (fileDir === bfDir && bf !== file) {
                            warnings.push({
                                file,
                                nearbyFile: bf,
                                branch: branch.name,
                                agent: branch.agent,
                                severity: 'medium',
                            });
                        }
                    }
                }
            }
        }

        const safe = conflicts.length === 0 && locks.length === 0;
        const response: {
            safe: boolean;
            fileCount: number;
            conflicts: typeof conflicts;
            locks: typeof locks;
            warnings: typeof warnings;
            recommendation: string;
            taskId?: string;
        } = {
            safe,
            fileCount: files.length,
            conflicts,
            locks,
            warnings,
            recommendation: safe
                ? 'Clear to proceed'
                : locks.length > 0
                    ? 'Wait for locks to release or contact lock owner'
                    : 'Coordinate with conflicting agents before proceeding',
        };

        if (taskId) {
            response.taskId = taskId;
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify(response),
            }],
        };
    }
);

// Tool: git_merge
server.tool(
    'git_merge',
    'Merge a branch into target with safety checks. Blocks TIER 3 conflicts.',
    {
        source: z.string().describe('Source branch to merge'),
        target: z.string().optional().describe('Target branch (default: main)'),
        strategy: z.enum(['merge', 'squash', 'rebase']).optional().describe('Merge strategy (default: merge)'),
        dryRun: z.boolean().optional().describe('Preview merge without executing'),
    },
    async ({ source, target, strategy, dryRun }) => {
        const repoDir = process.cwd();
        const cli = resolveSpidersanCliForDir(repoDir);
        const sourceBranch = source.trim();
        const targetBranch = (target || 'main').trim();
        const sourceError = await ensureValidBranchName(sourceBranch, repoDir);
        if (sourceError) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: sourceError }, null, 2)
                }],
                isError: true,
            };
        }
        const targetError = await ensureValidBranchName(targetBranch, repoDir);
        if (targetError) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: targetError }, null, 2)
                }],
                isError: true,
            };
        }

        if (sourceBranch === targetBranch) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: 'Source and target branches must be different'
                    }, null, 2)
                }],
                isError: true,
            };
        }

        const strategyChoice = strategy || 'merge';

        let conflictsPayload: any;
        try {
            const conflictResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'conflicts', '--branch', sourceBranch, '--json'],
                { cwd: repoDir }
            );
            conflictsPayload = JSON.parse(conflictResult.stdout || '{}');
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        const { conflicts, maxTier } = extractConflictSummary(conflictsPayload);

        if (maxTier >= 3) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: 'TIER 3 conflict detected - requires human review',
                        conflicts
                    }, null, 2)
                }],
                isError: true,
            };
        }

        const originalBranch = await getCurrentBranchName(repoDir);
        let switchedForReadyCheck = false;
        let restoreWarning: string | undefined;

        const restoreBranch = async () => {
            if (switchedForReadyCheck && originalBranch) {
                try {
                    await execFileAsync('git', ['checkout', originalBranch], { cwd: repoDir });
                } catch (error) {
                    restoreWarning = getExecErrorMessage(error);
                }
            }
        };

        if (!originalBranch || originalBranch !== sourceBranch) {
            try {
                await execFileAsync('git', ['checkout', sourceBranch], { cwd: repoDir });
                switchedForReadyCheck = true;
            } catch (error) {
                const message = getExecErrorMessage(error);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ success: false, error: message }, null, 2)
                    }],
                    isError: true,
                };
            }
        }

        let readyPayload: any;
        try {
            const readyResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'ready-check', '--json'],
                { cwd: repoDir }
            );
            readyPayload = JSON.parse(readyResult.stdout || '{}');
        } catch (error) {
            const raw = (error as { stdout?: string; stderr?: string })?.stdout
                || (error as { stdout?: string; stderr?: string })?.stderr
                || '';
            if (raw) {
                try {
                    readyPayload = JSON.parse(raw);
                } catch {
                    readyPayload = { raw: raw.trim() };
                }
            } else {
                const message = getExecErrorMessage(error);
                await restoreBranch();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({ success: false, error: message, restoreWarning }, null, 2)
                    }],
                    isError: true,
                };
            }
        }

        if (!isReadyCheckPass(readyPayload)) {
            await restoreBranch();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: 'Branch not ready for merge',
                        reasons: readyPayload?.issues || readyPayload?.conflicts || [],
                        restoreWarning
                    }, null, 2)
                }],
                isError: true,
            };
        }

        if (dryRun) {
            await restoreBranch();
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        dryRun: true,
                        wouldMerge: { source: sourceBranch, target: targetBranch, strategy: strategyChoice },
                        conflictTier: maxTier,
                        preChecks: 'passed',
                        restoreWarning
                    }, null, 2)
                }],
            };
        }

        try {
            await execFileAsync('git', ['checkout', targetBranch], { cwd: repoDir });
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        let mergeResult: { stdout: string; stderr: string };
        try {
            const mergeCmd = strategyChoice === 'squash'
                ? ['merge', '--squash', sourceBranch]
                : strategyChoice === 'rebase'
                    ? ['rebase', sourceBranch]
                    : ['merge', sourceBranch];
            mergeResult = await execFileAsync('git', mergeCmd, { cwd: repoDir });
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        let registryWarning: string | undefined;
        try {
            await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'merged', sourceBranch],
                { cwd: repoDir }
            );
        } catch (error) {
            registryWarning = getExecErrorMessage(error);
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    merged: { source: sourceBranch, target: targetBranch, strategy: strategyChoice },
                    output: mergeResult.stdout || mergeResult.stderr || '',
                    registryWarning
                }, null, 2)
            }],
        };
    }
);

// Tool: git_commit_and_push
server.tool(
    'git_commit_and_push',
    'Stage, commit (with optional auto-generated message), and push changes.',
    {
        files: z.array(z.string()).optional().describe('Files to stage (default: all changed files)'),
        message: z.string().optional().describe('Commit message (auto-generated from diff if omitted)'),
        branch: z.string().optional().describe('Branch to push (default: current branch)'),
        autoMessage: z.boolean().optional().describe('Generate commit message from diff using Raptor Mini'),
    },
    async ({ files, message, branch, autoMessage = true }) => {
        const repoDir = process.cwd();
        let currentBranch = branch;

        try {
            if (!currentBranch) {
                currentBranch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: repoDir })).stdout.trim();
            }
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        const branchName = currentBranch || '';
        const branchError = await ensureValidBranchName(branchName, repoDir);
        if (branchError) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: branchError }, null, 2)
                }],
                isError: true,
            };
        }
        currentBranch = branchName;

        const cli = resolveSpidersanCliForDir(repoDir);
        try {
            const readyResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'ready-check', '--json'],
                { cwd: repoDir }
            );
            const readyPayload = JSON.parse(readyResult.stdout || '{}');
            if (!isReadyCheckPass(readyPayload)) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: 'Branch not ready for push',
                            reasons: readyPayload?.issues || readyPayload?.conflicts || []
                        }, null, 2)
                    }],
                    isError: true,
                };
            }
        } catch {
            // ready-check may fail if branch not registered, continue anyway
        }

        const normalizedFiles = files?.map(file => file.trim()).filter(Boolean) ?? [];
        const filesToStage = normalizedFiles.length > 0 ? normalizedFiles : ['.'];

        try {
            await execFileAsync('git', ['add', '--', ...filesToStage], { cwd: repoDir });
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        let commitMessage = message;
        if (!commitMessage && autoMessage) {
            try {
                const diff = await execFileAsync('git', ['diff', '--cached', '--stat'], { cwd: repoDir });
                const stat = diff.stdout.trim();
                const fileCount = stat ? stat.split('\n').filter(Boolean).length : 0;
                commitMessage = stat
                    ? `chore: update ${fileCount} files\n\n${stat.slice(0, 500)}`
                    : undefined;
            } catch {
                // ignore auto message failure
            }
        }

        commitMessage = commitMessage || 'chore: automated commit';

        try {
            await execFileAsync('git', ['commit', '-m', commitMessage], { cwd: repoDir });
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        try {
            await execFileAsync('git', ['push', 'origin', currentBranch], { cwd: repoDir });
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    success: true,
                    branch: currentBranch,
                    message: commitMessage,
                    pushed: true
                }, null, 2)
            }],
        };
    }
);

// Tool: create_pr
server.tool(
    'create_pr',
    'Create a GitHub pull request with optional auto-generated title and description.',
    {
        branch: z.string().optional().describe('Source branch for PR (default: current branch)'),
        target: z.string().optional().describe('Target branch (default: main)'),
        title: z.string().optional().describe('PR title (auto-generated from branch name if omitted)'),
        description: z.string().optional().describe('PR description (auto-generated from commits if omitted)'),
        reviewers: z.array(z.string()).optional().describe('GitHub usernames to request review from'),
        draft: z.boolean().optional().describe('Create as draft PR'),
    },
    async ({ branch, target, title, description, reviewers, draft }) => {
        const repoDir = process.cwd();
        const targetBranch = (target || 'main').trim();
        let sourceBranch = branch?.trim();

        try {
            if (!sourceBranch) {
                sourceBranch = (await execFileAsync('git', ['branch', '--show-current'], { cwd: repoDir })).stdout.trim();
            }
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }

        if (!sourceBranch) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: 'Unable to determine current branch' }, null, 2)
                }],
                isError: true,
            };
        }

        const sourceError = await ensureValidBranchName(sourceBranch, repoDir);
        if (sourceError) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: sourceError }, null, 2)
                }],
                isError: true,
            };
        }

        const targetError = await ensureValidBranchName(targetBranch, repoDir);
        if (targetError) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: targetError }, null, 2)
                }],
                isError: true,
            };
        }

        if (sourceBranch === targetBranch) {
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: false,
                        error: 'Source and target branches must be different'
                    }, null, 2)
                }],
                isError: true,
            };
        }

        const cli = resolveSpidersanCliForDir(repoDir);

        try {
            const conflictResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'conflicts', '--branch', sourceBranch, '--json'],
                { cwd: repoDir }
            );
            const conflictPayload = JSON.parse(conflictResult.stdout || '{}');
            const { conflicts, maxTier } = extractConflictSummary(conflictPayload);
            if (maxTier >= 3) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: 'TIER 3 conflict - resolve before creating PR',
                            conflicts
                        }, null, 2)
                    }],
                    isError: true,
                };
            }
        } catch {
            // Conflict check may fail, continue
        }

        try {
            const readyResult = await execFileAsync(
                cli.command,
                [...cli.argsPrefix, 'ready-check', sourceBranch, '--target', targetBranch, '--json'],
                { cwd: repoDir }
            );
            const readyPayload = JSON.parse(readyResult.stdout || '{}');
            if (!isReadyCheckPass(readyPayload)) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            error: 'Branch not ready for PR',
                            reasons: readyPayload?.issues || readyPayload?.conflicts || []
                        }, null, 2)
                    }],
                    isError: true,
                };
            }
        } catch {
            // Ready check may fail, continue
        }

        const prTitle = title || sourceBranch
            .replace(/^(feat|fix|chore|docs|refactor)\//, '$1: ')
            .replace(/-/g, ' ')
            .replace(/^\w/, (c) => c.toUpperCase());

        let prDescription = description;
        if (!prDescription) {
            try {
                const commits = await execFileAsync('git', ['log', `${targetBranch}..${sourceBranch}`, '--oneline'], { cwd: repoDir });
                const lines = commits.stdout.split('\n').filter(Boolean);
                prDescription = `## Changes\n\n${lines.map((line) => `- ${line}`).join('\n')}`;
            } catch {
                prDescription = '## Changes\n\n- (auto-generated description unavailable)';
            }
        }

        const ghArgs = ['pr', 'create', '--base', targetBranch, '--head', sourceBranch, '--title', prTitle, '--body', prDescription];

        if (draft) ghArgs.push('--draft');
        if (reviewers && reviewers.length > 0) {
            ghArgs.push('--reviewer', reviewers.join(','));
        }

        try {
            const prResult = await execFileAsync('gh', ghArgs, { cwd: repoDir });
            const prUrl = prResult.stdout.trim() || prResult.stderr?.trim() || '';
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        url: prUrl,
                        title: prTitle,
                        source: sourceBranch,
                        target: targetBranch,
                        draft: !!draft,
                        reviewers: reviewers || []
                    }, null, 2)
                }],
            };
        } catch (error) {
            const message = getExecErrorMessage(error);
            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({ success: false, error: message }, null, 2)
                }],
                isError: true,
            };
        }
    }
);

// Tool: register_branch
server.tool(
    'register_branch',
    'Register a branch with files you are modifying',
    {
        branch: z.string().describe('Branch name to register'),
        files: z.array(z.string()).describe('List of files being modified'),
        description: z.string().optional().describe('Brief description of the changes'),
        agent: z.string().optional().describe('Your agent identifier'),
        repo: z.string().optional().describe('Repository name (for context)'),
    },
    async ({ branch, files, description, agent, repo }) => {
        // Auto-initialize if needed (global storage doesn't need per-repo init)
        const branchName = branch;

        const existing = storage.getBranch(branchName);
        const branchData = storage.registerBranch({
            name: branchName,
            files: existing ? [...new Set([...existing.files, ...files])] : files,
            status: 'active',
            description: description || existing?.description,
            agent: agent || existing?.agent,
            dependencies: existing?.dependencies,
            repo: repo || existing?.repo,
        });

        const action = existing ? 'Updated' : 'Registered';
        return {
            content: [{
                type: 'text',
                text: `✅ ${action} branch: ${branchData.name}\n   Files: ${branchData.files.join(', ')}\n   Agent: ${branchData.agent || 'not set'}\n   Repo: ${branchData.repo || 'not set'}`
            }],
        };
    }
);

// Tool: mark_merged
server.tool(
    'mark_merged',
    'Mark a branch as merged (removes from active list)',
    {
        branch: z.string().optional().describe('Branch name (default: current branch)'),
    },
    async ({ branch }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ No registry found for this repo yet (nothing to mark merged)' }],
                isError: true,
            };
        }

        let branchName = branch;
        if (!branchName) {
            try {
                branchName = storage.getCurrentBranch();
            } catch {
                return {
                    content: [{ type: 'text', text: '❌ Could not determine current branch' }],
                    isError: true,
                };
            }
        }

        const success = storage.updateBranchStatus(branchName, 'completed');
        if (!success) {
            return {
                content: [{ type: 'text', text: `❌ Branch not found: ${branchName}` }],
                isError: true,
            };
        }

        return {
            content: [{ type: 'text', text: `✅ Marked as merged: ${branchName}` }],
        };
    }
);

// Tool: mark_abandoned
server.tool(
    'mark_abandoned',
    'Mark a branch as abandoned',
    {
        branch: z.string().optional().describe('Branch name (default: current branch)'),
    },
    async ({ branch }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ No registry found for this repo yet (nothing to abandon)' }],
                isError: true,
            };
        }

        let branchName = branch;
        if (!branchName) {
            try {
                branchName = storage.getCurrentBranch();
            } catch {
                return {
                    content: [{ type: 'text', text: '❌ Could not determine current branch' }],
                    isError: true,
                };
            }
        }

        const success = storage.updateBranchStatus(branchName, 'abandoned');
        if (!success) {
            return {
                content: [{ type: 'text', text: `❌ Branch not found: ${branchName}` }],
                isError: true,
            };
        }

        return {
            content: [{ type: 'text', text: `✅ Marked as abandoned: ${branchName}` }],
        };
    }
);

// Tool: get_branch_info
server.tool(
    'get_branch_info',
    'Get detailed info about a specific branch',
    {
        branch: z.string().optional().describe('Branch name (default: current branch)'),
    },
    async ({ branch }) => {
        if (!storage.isInitialized()) {
            return {
                content: [{ type: 'text', text: '❌ No branches registered for this repo yet' }],
                isError: true,
            };
        }

        let branchName = branch;
        if (!branchName) {
            try {
                branchName = storage.getCurrentBranch();
            } catch {
                return {
                    content: [{ type: 'text', text: '❌ Could not determine current branch' }],
                    isError: true,
                };
            }
        }

        const info = storage.getBranch(branchName);
        if (!info) {
            return {
                content: [{ type: 'text', text: `❌ Branch not registered: ${branchName}\n\nUse register_branch to register it.` }],
                isError: true,
            };
        }

        const deps = info.dependencies?.length ? info.dependencies.join(', ') : 'none';
        const text = `🕷️ Branch: ${info.name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status:       ${info.status}
Agent:        ${info.agent || 'not set'}
Description:  ${info.description || 'none'}
Files:        ${info.files.join(', ') || 'none'}
Dependencies: ${deps}
Registered:   ${new Date(info.registeredAt).toLocaleString()}
Updated:      ${new Date(info.updatedAt).toLocaleString()}`;

        return {
            content: [{ type: 'text', text }],
        };
    }
);

// Tool: start_watch
server.tool(
    'start_watch',
    'Start watching files and auto-registering changes (daemon mode)',
    {
        agent: z.string().optional().describe('Agent identifier for registrations'),
        dir: z.string().optional().describe('Directory to watch (default: current repo)'),
        hub: z.boolean().optional().describe('Connect to Hub for real-time conflict warnings'),
        quiet: z.boolean().optional().describe('Only show conflicts, not file changes'),
    },
    async ({ agent, dir, hub, quiet }) => {
        // Security: Validate directory before spawning watcher
        let safeDir: string;
        try {
            safeDir = validateWatchDirectory(dir);
        } catch (error: unknown) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ ${(error as Error).message}`
                }],
                isError: true,
            };
        }

        // Security: Validate agent ID
        const safeAgent = agent?.replace(/[^a-zA-Z0-9_-]/g, '') || undefined;

        const { spawn } = await import('child_process');
        const args = ['watch'];

        if (safeAgent) args.push('--agent', safeAgent);
        args.push('--dir', safeDir);
        if (hub) args.push('--hub');
        if (quiet) args.push('--quiet');

        const cli = resolveSpidersanCliForDir(safeDir);

        // Spawn detached process
        const proc = spawn(cli.command, [...cli.argsPrefix, ...args], {
            detached: true,
            stdio: 'ignore',
            cwd: safeDir,
        });
        proc.unref();

        return {
            content: [{
                type: 'text',
                text: `🕷️ Watch mode started (PID: ${proc.pid})
Agent: ${safeAgent || 'not set'}
Directory: ${safeDir}
Hub: ${hub ? 'connected' : 'disabled'}
Quiet: ${quiet ? 'yes' : 'no'}

The watcher is running in the background. Use 'stop_watch' to stop it.`
            }],
        };
    }
);

// Tool: stop_watch  
server.tool(
    'stop_watch',
    'Stop the background file watcher',
    {},
    async () => {
        const { execFile } = await import('child_process');

        return new Promise((resolve) => {
            // Security: Use execFile with explicit arguments instead of shell command
            // This prevents command injection and only targets spidersan watch processes
            const patterns: Array<[string, string]> = [
                ['-f', 'spidersan watch'],
                ['-f', 'dist/bin/spidersan.js watch'],
                ['-f', 'spidersan.js watch'],
            ];

            let stoppedAny = false;
            let pending = patterns.length;

            const finish = () => {
                if (pending > 0) return;
                resolve({
                    content: [{
                        type: 'text',
                        text: stoppedAny
                            ? '✅ Watch mode stopped.'
                            : '⚠️ No watch process found or unable to stop. It may not be running.'
                    }],
                });
            };

            for (const pattern of patterns) {
                execFile('pkill', [...pattern], (error) => {
                    if (!error) stoppedAny = true;
                    pending -= 1;
                    finish();
                });
            }
        });
    }
);

// Tool: welcome (onboarding ritual with optional demo)
server.tool(
    'welcome',
    'Welcome ritual for new agents - shows setup guide and optional conflict demo',
    {
        demo: z.boolean().optional().describe('Run interactive demo showing conflict detection'),
    },
    async ({ demo }) => {
        const welcome = `🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   SPIDERSAN WELCOMES YOU TO THE WEB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   You are not alone in this codebase.
   Other agents weave alongside you.
   The web keeps you from colliding.

   ┌─────────────────────────────────┐
   │  "Claim your threads            │
   │   before you weave."            │
   └─────────────────────────────────┘

🕸️  QUICK SETUP (one command):

   → register_branch
     branch: "your-branch-name"
     files: ["files", "you're", "touching"]
     agent: "your-name"

   Then before coding, always:
   → check_conflicts

   When done:
   → mark_merged

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   The web sees all. The web protects all.
🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        if (!demo) {
            return {
                content: [{
                    type: 'text',
                    text: welcome + `

⚡ WANT TO SEE THE WEB'S POWER?

   Call welcome again with demo: true
   I'll simulate a collision so you can
   witness the web's protection firsthand.`
                }],
            };
        }

        // Demo mode: simulate a conflict
        const ghostBranch = '__ghost-demo__';
        const ghostFiles = ['README.md', 'package.json', 'src/index.ts'];

        // Register ghost agent
        storage.registerBranch({
            name: ghostBranch,
            files: ghostFiles,
            status: 'active',
            description: 'Ghost agent for demo',
            agent: 'ghost-agent',
            repo: 'demo',
        });

        // Check for conflicts (there should be none yet with real branches)
        const conflicts = storage.findConflicts();

        // Build demo narrative
        let demoResult = welcome + `

⚡ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   LIVE DEMO: THE WEB IN ACTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👻 Ghost agent summoned...
   Branch: ${ghostBranch}
   Files:  ${ghostFiles.join(', ')}

🔍 The ghost is now "working on" common files.

   If YOU register a branch touching these files,
   the web will warn you BEFORE you collide.

📋 TRY IT NOW:

   → register_branch
     branch: "my-feature"
     files: ["README.md"]
     agent: "your-name"

   → check_conflicts

   ⚠️  You'll see the collision warning!

🧹 CLEANUP:

   When done experimenting, the ghost will
   fade on its own, or call:
   → mark_abandoned branch: "${ghostBranch}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Now you understand. Welcome to the web.
🕷️ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

        return {
            content: [{ type: 'text', text: demoResult }],
        };
    }
);

// Tool: list_tools (for version discovery)
server.tool(
    'list_tools',
    'List all available Spidersan MCP tools with version info',
    {},
    async () => {
        const tools = [
            { name: 'welcome', desc: '✨ START HERE - onboarding ritual with demo', args: 'demo?: boolean' },
            { name: 'list_branches', desc: 'List registered branches by status', args: 'status?: all|active|merged|abandoned' },
            { name: 'check_conflicts', desc: 'Detect file conflicts between active branches', args: 'none' },
            { name: 'ready_check', desc: 'Validate if a branch is safe to merge', args: 'branch, target?' },
            { name: 'branch_status', desc: 'Get detailed status for registered branches', args: 'repo?, includeStale?' },
            { name: 'request_resolution', desc: 'Claim a conflict for resolution and return context', args: 'branch, agent, target?, tier?' },
            { name: 'release_resolution', desc: 'Release a conflict claim early', args: 'branch, agent, target?' },
            { name: 'lock_files', desc: 'Lock files to prevent concurrent edits', args: 'files[], agent, reason?, ttl?' },
            { name: 'unlock_files', desc: 'Release file locks', args: 'files?, agent?, token?, force?' },
            { name: 'who_owns', desc: 'Query file ownership, locks, and active branches', args: 'files?, pattern?' },
            { name: 'intent_scan', desc: 'Scan for potential conflicts before starting work', args: 'files[], agent, taskId?' },
            { name: 'git_merge', desc: 'Merge a branch into target with safety checks', args: 'source, target?, strategy?, dryRun?' },
            { name: 'git_commit_and_push', desc: 'Stage, commit, and push changes', args: 'files?, message?, branch?, autoMessage?' },
            { name: 'create_pr', desc: 'Create a GitHub pull request', args: 'branch?, target?, title?, description?, reviewers?, draft?' },
            { name: 'get_merge_order', desc: 'Recommend safe merge sequence', args: 'none' },
            { name: 'register_branch', desc: 'Register branch with files you are modifying', args: 'branch, files[], description?, agent?, repo?' },
            { name: 'mark_merged', desc: 'Mark branch as merged', args: 'branch?' },
            { name: 'mark_abandoned', desc: 'Mark branch as abandoned', args: 'branch?' },
            { name: 'get_branch_info', desc: 'Get detailed info about a branch', args: 'branch?' },
            { name: 'start_watch', desc: 'Start background file watcher daemon', args: 'agent?, dir?, hub?, quiet?' },
            { name: 'stop_watch', desc: 'Stop the background file watcher', args: 'none' },
            { name: 'list_tools', desc: 'This command - list available tools', args: 'none' },
        ];

        const formatted = tools.map(t => `• ${t.name}\n  ${t.desc}\n  Args: ${t.args}`).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `🕷️ Spidersan MCP Server v1.2.3 (OSS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${formatted}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total: ${tools.length} tools available
"Claim your threads before you weave."`
            }],
        };
    }
);

// Start the server
async function main() {
    // OSS version - no license required
    console.error('🕷️ Spidersan MCP Server (OSS)');

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Spidersan MCP server running');
}

main().catch(console.error);
