/**
 * Spidersan AI Core — Context Builder
 *
 * Aggregates context from all sources into structured SpiderContext.
 * Uses storage adapter (not raw file reads) and pure functions (no CLI shelling).
 * Each source is best-effort — failures are reported, not fatal.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { getStorage } from '../../storage/factory.js';
import { classifyTier } from '../conflict-tier.js';
import type { Branch } from '../../storage/adapter.js';
import type {
  BranchSummary,
  ConflictSummary,
  SpiderContext,
  WorkSignal,
  ActivityEntry,
} from './types.js';

const execFileAsync = promisify(execFile);

interface ContextSource<T> {
  available: boolean;
  data: T;
  error?: string;
}

export interface BuildContextOptions {
  repoRoot?: string;
  includeActivity?: boolean;
  includeDaily?: boolean;
  verbose?: boolean;
}

// ─── Git Helpers ────────────────────────────────────────────

async function getGitInfo(cwd: string): Promise<ContextSource<{
  branch: string;
  repo: string;
  ahead: number;
  behind: number;
  dirty: string[];
}>> {
  try {
    const opts = { cwd, timeout: 5000 };
    const [branchResult, statusResult, remoteResult] = await Promise.all([
      execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts),
      execFileAsync('git', ['status', '--porcelain'], opts),
      execFileAsync('git', ['remote', 'get-url', 'origin'], opts).catch(() => ({ stdout: '' })),
    ]);

    const branch = branchResult.stdout.trim();
    const dirty = statusResult.stdout.trim().split('\n').filter(Boolean).map(l => l.slice(3));
    const repo = remoteResult.stdout.trim().replace(/.*[:/]([^/]+\/[^/]+?)(?:\.git)?$/, '$1');

    let ahead = 0, behind = 0;
    try {
      const revList = await execFileAsync(
        'git', ['rev-list', '--left-right', '--count', `origin/${branch}...HEAD`], opts,
      );
      const parts = revList.stdout.trim().split(/\s+/);
      behind = parseInt(parts[0] ?? '0', 10);
      ahead = parseInt(parts[1] ?? '0', 10);
    } catch { /* no remote tracking */ }

    return { available: true, data: { branch, repo, ahead, behind, dirty } };
  } catch (err) {
    return {
      available: false,
      data: { branch: 'unknown', repo: 'unknown', ahead: 0, behind: 0, dirty: [] },
      error: (err as Error).message,
    };
  }
}

// ─── Registry & Conflict Detection ─────────────────────────

async function getRegistryContext(currentBranch: string): Promise<ContextSource<{
  active: number;
  stale: number;
  branches: BranchSummary[];
  conflicts: ConflictSummary[];
}>> {
  try {
    const storage = await getStorage();
    const allBranches = await storage.list();
    const staleThreshold = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const branches: BranchSummary[] = allBranches.map((b: Branch) => ({
      name: b.name,
      agent: b.agent ?? null,
      files: b.files,
      status: b.status,
      lastUpdated: b.registeredAt instanceof Date
        ? b.registeredAt.toISOString()
        : new Date(b.registeredAt).toISOString(),
      commitsBehindMain: 0,
    }));

    const activeBranches = branches.filter(b => b.status === 'active');
    const staleBranches = branches.filter(
      b => b.status === 'active' && new Date(b.lastUpdated).getTime() < staleThreshold,
    );

    // Compute conflicts: find file overlaps between current branch and others
    const currentEntry = allBranches.find((b: Branch) => b.name === currentBranch);
    const currentFiles = currentEntry?.files ?? [];
    const conflicts: ConflictSummary[] = [];

    if (currentFiles.length > 0) {
      // ⚡ Bolt: Use a Set for O(1) lookups instead of Array.includes for O(N) to improve conflict detection speed
      // when checking many files against many active branches.
      const currentFilesSet = new Set(currentFiles);
      for (const other of allBranches) {
        if (other.name === currentBranch || other.status !== 'active') continue;
        const overlapping = other.files.filter(f => currentFilesSet.has(f));
        if (overlapping.length > 0) {
          const maxTier = Math.max(...overlapping.map(file => classifyTier(file))) as ReturnType<typeof classifyTier>;
          conflicts.push({
            branch: currentBranch,
            otherBranch: other.name,
            tier: maxTier,
            files: overlapping,
            agent: currentEntry?.agent ?? null,
            otherAgent: other.agent ?? null,
          });
        }
      }
    }

    return {
      available: true,
      data: {
        active: activeBranches.length,
        stale: staleBranches.length,
        branches,
        conflicts,
      },
    };
  } catch (err) {
    return {
      available: false,
      data: { active: 0, stale: 0, branches: [], conflicts: [] },
      error: (err as Error).message,
    };
  }
}

// ─── Colony (read-only snapshot) ────────────────────────────

async function getColonySnapshot(): Promise<ContextSource<{
  online: boolean;
  activeAgents: string[];
  inProgress: WorkSignal[];
}>> {
  const colonyUrl = process.env['COLONY_SUPABASE_URL'];
  const colonyKey = process.env['COLONY_SUPABASE_KEY'];

  if (!colonyUrl || !colonyKey) {
    return { available: false, data: { online: false, activeAgents: [], inProgress: [] }, error: 'Colony not configured' };
  }

  try {
    const resp = await fetch(
      `${colonyUrl}/rest/v1/colony_state?status=eq.in-progress&select=agent_label,task,status,last_heartbeat`,
      {
        headers: {
          'apikey': colonyKey,
          'Authorization': `Bearer ${colonyKey}`,
        },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!resp.ok) throw new Error(`Colony API ${resp.status}`);
    const rows = await resp.json() as Array<{
      agent_label: string;
      task: string;
      status: string;
      last_heartbeat: string;
    }>;

    return {
      available: true,
      data: {
        online: true,
        activeAgents: [...new Set(rows.map(r => r.agent_label))],
        inProgress: rows.map(r => ({
          agent: r.agent_label,
          task: r.task,
          status: r.status,
          lastHeartbeat: r.last_heartbeat,
        })),
      },
    };
  } catch (err) {
    return {
      available: false,
      data: { online: false, activeAgents: [], inProgress: [] },
      error: (err as Error).message,
    };
  }
}

// ─── Activity Log (best-effort) ────────────────────────────

async function getRecentActivity(_repoRoot: string): Promise<ContextSource<ActivityEntry[]>> {
  try {
    const { readFileSync, existsSync } = await import('fs');
    const { join } = await import('path');
    const { homedir } = await import('os');

    const logPath = join(homedir(), '.spidersan', 'activity.jsonl');
    if (!existsSync(logPath)) {
      return { available: false, data: [], error: 'No activity log found' };
    }

    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n').filter(Boolean);
    const entries: ActivityEntry[] = [];

    for (const line of lines.slice(-100)) {
      try {
        const record = JSON.parse(line) as {
          event: string;
          branch: string | null;
          agent: string | null;
          details: Record<string, unknown>;
          created_at: string;
          repo?: string;
        };
        if (new Date(record.created_at).getTime() > cutoff) {
          entries.push({
            event: record.event,
            branch: record.branch,
            agent: record.agent,
            details: record.details,
            timestamp: record.created_at,
          });
        }
      } catch { /* skip malformed lines */ }
    }

    return { available: true, data: entries };
  } catch (err) {
    return { available: false, data: [], error: (err as Error).message };
  }
}

// ─── Main Builder ───────────────────────────────────────────

export async function buildContext(options: BuildContextOptions = {}): Promise<SpiderContext> {
  const cwd = options.repoRoot ?? process.cwd();

  // Gather all sources in parallel (all best-effort)
  const [gitInfo, registryCtx, colonyCtx, activityCtx] = await Promise.all([
    getGitInfo(cwd),
    getGitInfo(cwd).then(g => getRegistryContext(g.data.branch)),
    getColonySnapshot(),
    options.includeActivity ? getRecentActivity(cwd) : Promise.resolve(undefined),
  ]);

  const conflicts = registryCtx.data.conflicts;

  const context: SpiderContext = {
    timestamp: new Date().toISOString(),
    repo: gitInfo.data.repo,
    branch: gitInfo.data.branch,
    registry: {
      active: registryCtx.data.active,
      stale: registryCtx.data.stale,
      branches: registryCtx.data.branches,
    },
    conflicts: {
      tier1: conflicts.filter(c => c.tier === 1).length,
      tier2: conflicts.filter(c => c.tier === 2).length,
      tier3: conflicts.filter(c => c.tier === 3).length,
      details: conflicts,
    },
    gitStatus: {
      ahead: gitInfo.data.ahead,
      behind: gitInfo.data.behind,
      dirty: gitInfo.data.dirty,
    },
    colony: colonyCtx.data,
  };

  if (activityCtx?.available) {
    context.activityLog = activityCtx.data;
  }

  return context;
}
