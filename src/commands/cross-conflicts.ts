/**
 * spidersan cross-conflicts
 * 
 * Detect file conflicts ACROSS machines by comparing registries in Supabase.
 * Extends the local `conflicts` command to work globally.
 * 
 * Flow:
 * 1. Push local registry to Supabase (ensure freshness)
 * 2. Pull all other machines' registries
 * 3. Compare file lists, apply tier escalation
 * 4. Produce a GlobalConflictReport
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import type {
    CrossMachineConflict,
    GlobalConflictReport,
    MachineRegistryView,
    SpiderRegistry,
} from '../types/cloud.js';

// ─── Tier Classification (mirrors conflicts.ts logic) ───

const TIER_3_PATTERNS = [
    /\.env$/,
    /secrets?\./i,
    /credentials/i,
    /password/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /\.pem$/,
    /auth\.(ts|js)$/,
    /security\.(ts|js)$/,
];

const TIER_2_PATTERNS = [
    /package\.json$/,
    /package-lock\.json$/,
    /tsconfig\.json$/,
    /CLAUDE\.md$/,
    /\.gitignore$/,
    /server\.(ts|js)$/,
    /index\.(ts|js)$/,
    /config\.(ts|js)$/,
];

function classifyTier(file: string): 1 | 2 | 3 {
    for (const p of TIER_3_PATTERNS) {
        if (p.test(file)) return 3;
    }
    for (const p of TIER_2_PATTERNS) {
        if (p.test(file)) return 2;
    }
    return 1;
}

const TIER_LABELS: Record<number, { label: string; icon: string; action: string }> = {
    1: { label: 'WARN', icon: '🟡', action: 'Proceed with caution' },
    2: { label: 'PAUSE', icon: '🟠', action: 'Coordinate with remote agent before proceeding' },
    3: { label: 'BLOCK', icon: '🔴', action: 'Must resolve before merge — cross-machine conflict' },
};

// ─── Core: Detect Cross-Machine Conflicts ───

interface BranchRef {
    branch_name: string;
    machine_id: string;
    machine_name: string;
    agent: string | null;
    repo_name: string;
}

export function detectCrossMachineConflicts(
    localBranches: SpiderRegistry[],
    remoteMachines: MachineRegistryView[],
    localMachineId: string,
    localMachineName: string,
): CrossMachineConflict[] {
    // Build file → branch refs map
    const fileMap = new Map<string, BranchRef[]>();

    // Add local branches
    for (const branch of localBranches) {
        if (branch.status !== 'active') continue;
        for (const file of branch.files) {
            if (!fileMap.has(file)) fileMap.set(file, []);
            fileMap.get(file)!.push({
                branch_name: branch.branch_name,
                machine_id: localMachineId,
                machine_name: localMachineName,
                agent: branch.agent,
                repo_name: branch.repo_name,
            });
        }
    }

    // Add remote branches
    for (const machine of remoteMachines) {
        for (const branch of machine.branches) {
            if (branch.status !== 'active') continue;
            for (const file of branch.files) {
                if (!fileMap.has(file)) fileMap.set(file, []);
                fileMap.get(file)!.push({
                    branch_name: branch.name,
                    machine_id: machine.machine_id,
                    machine_name: machine.machine_name,
                    agent: branch.agent || null,
                    repo_name: machine.repo_name,
                });
            }
        }
    }

    // Find files touched by multiple machines
    const conflicts: CrossMachineConflict[] = [];
    for (const [file, refs] of fileMap) {
        const machineIds = new Set(refs.map(r => r.machine_id));
        if (machineIds.size < 2) continue; // Same machine only — not a cross-machine conflict

        const tier = classifyTier(file);
        conflicts.push({
            file,
            tier,
            branches: refs.map(r => ({
                branch_name: r.branch_name,
                machine_id: r.machine_id,
                machine_name: r.machine_name,
                agent: r.agent,
            })),
        });
    }

    // Sort: TIER 3 first, then 2, then 1
    conflicts.sort((a, b) => b.tier - a.tier);
    return conflicts;
}

// ─── Local-Only Mode (no Supabase) ───

async function detectLocalConflicts(repoName: string): Promise<GlobalConflictReport> {
    const storage = await getStorage();
    const branches = await storage.list();
    const activeBranches = branches.filter((b: any) => b.status === 'active');

    // In local mode, detect conflicts within the same machine
    const fileMap = new Map<string, Array<{ branch: string; agent: string | null }>>();
    for (const branch of activeBranches) {
        for (const file of (branch.files || [])) {
            if (!fileMap.has(file)) fileMap.set(file, []);
            fileMap.get(file)!.push({
                branch: branch.name,
                agent: branch.agent || null,
            });
        }
    }

    const conflicts: CrossMachineConflict[] = [];
    for (const [file, refs] of fileMap) {
        if (refs.length < 2) continue;
        conflicts.push({
            file,
            tier: classifyTier(file),
            branches: refs.map(r => ({
                branch_name: r.branch,
                machine_id: 'local',
                machine_name: 'local',
                agent: r.agent,
            })),
        });
    }

    conflicts.sort((a, b) => b.tier - a.tier);
    return {
        conflicts,
        machines_scanned: 1,
        total_branches: activeBranches.length,
        scan_time: new Date().toISOString(),
    };
}

// ─── Format Output ───

function formatReport(report: GlobalConflictReport, minTier: number): string {
    const lines: string[] = [];
    const filtered = report.conflicts.filter(c => c.tier >= minTier);

    if (filtered.length === 0) {
        lines.push('✅ No cross-machine conflicts detected');
        lines.push(`   Scanned ${report.machines_scanned} machine(s), ${report.total_branches} active branch(es)`);
        return lines.join('\n');
    }

    lines.push(`⚡ ${filtered.length} cross-machine conflict(s) found`);
    lines.push(`   Scanned ${report.machines_scanned} machine(s), ${report.total_branches} active branch(es)`);
    lines.push('');

    for (const conflict of filtered) {
        const info = TIER_LABELS[conflict.tier];
        lines.push(`${info.icon} TIER ${conflict.tier} ${info.label}: ${conflict.file}`);
        lines.push(`   Action: ${info.action}`);
        for (const b of conflict.branches) {
            const agentLabel = b.agent ? ` (${b.agent})` : '';
            lines.push(`   ├─ ${b.machine_name}/${b.branch_name}${agentLabel}`);
        }
        lines.push('');
    }

    // Summary by tier
    const t3 = filtered.filter(c => c.tier === 3).length;
    const t2 = filtered.filter(c => c.tier === 2).length;
    const t1 = filtered.filter(c => c.tier === 1).length;
    lines.push(`Summary: 🔴 ${t3} BLOCK  🟠 ${t2} PAUSE  🟡 ${t1} WARN`);

    return lines.join('\n');
}

function formatJson(report: GlobalConflictReport, minTier: number): string {
    const filtered = {
        ...report,
        conflicts: report.conflicts.filter(c => c.tier >= minTier),
    };
    return JSON.stringify(filtered, null, 2);
}

// ─── CLI Command ───

export const crossConflictsCommand = new Command('cross-conflicts')
    .description('Detect file conflicts across machines (via Supabase)')
    .option('--repo <name>', 'Repository name (default: current repo)')
    .option('--tier <level>', 'Minimum tier to display (1, 2, or 3)', '1')
    .option('--strict', 'Exit with code 1 if TIER 2+ conflicts found')
    .option('--json', 'Output as JSON')
    .option('--local', 'Local-only mode (skip Supabase, use local registry)')
    .action(async (opts) => {
        const minTier = parseInt(opts.tier, 10) || 1;

        // Determine repo name
        let repoName = opts.repo;
        if (!repoName) {
            try {
                const path = await import('path');
                repoName = path.basename(process.cwd());
            } catch {
                repoName = 'unknown';
            }
        }

        // Local-only mode
        if (opts.local) {
            const report = await detectLocalConflicts(repoName);
            console.log(opts.json ? formatJson(report, minTier) : formatReport(report, minTier));
            if (opts.strict && report.conflicts.some(c => c.tier >= 2)) {
                process.exit(1);
            }
            return;
        }

        // Cross-machine mode via Supabase
        try {
            const storage = await getStorage();
            if (!('pushRegistry' in storage)) {
                console.log('⚠️  Supabase not configured. Use --local for local-only conflicts.');
                console.log('   Set SUPABASE_URL and SUPABASE_KEY, or run: spidersan cross-conflicts --local');
                return;
            }

            const supabase = storage as any;

            // Load machine identity
            let machineId = 'unknown';
            let machineName = 'unknown';
            try {
                const fs = await import('fs');
                const path = await import('path');
                const os = await import('os');
                const machineFile = path.join(os.default.homedir(), '.envoak', 'machine.json');
                if (fs.existsSync(machineFile)) {
                    const machine = JSON.parse(fs.readFileSync(machineFile, 'utf-8'));
                    machineId = machine.machine_id || machine.id || 'unknown';
                    machineName = machine.name || 'unknown';
                }
            } catch { /* use defaults */ }

            console.log(`🕷️  Scanning cross-machine conflicts for "${repoName}" from ${machineName}...`);
            console.log('');

            // Step 1: Push local registry to ensure freshness
            const branches = await storage.list();
            const activeBranches = branches.filter((b: any) => b.status === 'active');

            // Build local SpiderRegistry objects for comparison
            const localRegistries: SpiderRegistry[] = activeBranches.map((b: any) => ({
                id: '',
                machine_id: machineId,
                machine_name: machineName,
                hostname: '',
                repo_path: process.cwd(),
                repo_name: repoName,
                branch_name: b.name,
                files: b.files || [],
                agent: b.agent || null,
                description: b.description || null,
                status: 'active' as const,
                last_commit_sha: null,
                last_commit_date: null,
                synced_at: new Date().toISOString(),
                created_at: b.registeredAt?.toISOString() || new Date().toISOString(),
            }));

            // Step 2: Pull remote registries
            let remoteMachines: MachineRegistryView[] = [];
            try {
                remoteMachines = await supabase.pullRegistries(repoName, machineId);
            } catch (err: any) {
                console.log(`⚠️  Could not pull remote registries: ${err.message}`);
                console.log('   Falling back to local-only mode...');
                console.log('');
                const report = await detectLocalConflicts(repoName);
                console.log(opts.json ? formatJson(report, minTier) : formatReport(report, minTier));
                return;
            }

            // Step 3: Detect conflicts
            const conflicts = detectCrossMachineConflicts(
                localRegistries,
                remoteMachines,
                machineId,
                machineName,
            );

            const totalRemoteBranches = remoteMachines.reduce(
                (sum, m) => sum + m.branches.length, 0
            );

            const report: GlobalConflictReport = {
                conflicts,
                machines_scanned: remoteMachines.length + 1, // +1 for local
                total_branches: activeBranches.length + totalRemoteBranches,
                scan_time: new Date().toISOString(),
            };

            console.log(opts.json ? formatJson(report, minTier) : formatReport(report, minTier));

            if (opts.strict && conflicts.some(c => c.tier >= 2)) {
                process.exit(1);
            }
        } catch (err: any) {
            console.error(`Error: ${err.message}`);
            process.exit(1);
        }
    });
