/**
 * spidersan pulse
 *
 * Quick health-check: sync from Colony, then run local conflict detection.
 * Calls syncFromColony() first so that active work_claim signals from other
 * agents are reflected in the registry before conflicts are computed.
 *
 * Offline mode: if Colony is unreachable, prints a warning and continues
 * with existing local registry data — never crashes.
 */

import { Command } from 'commander';
import { compilePatterns } from '../lib/regex-utils.js';
import { execFileSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { syncFromColony } from '../lib/colony-subscriber.js';
import { loadConfig } from '../lib/config.js';

// Critical files — TIER 3 block
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

// Important files — TIER 2 pause
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


const COMPILED_TIER_3 = compilePatterns(TIER_3_PATTERNS);
const COMPILED_TIER_2 = compilePatterns(TIER_2_PATTERNS);

function classifyTier(file: string, compiledHigh: RegExp[] = [], compiledMedium: RegExp[] = []): 1 | 2 | 3 {
    const tier3 = [...COMPILED_TIER_3, ...compiledHigh];
    for (const p of tier3) {
        if (p.test(file)) return 3;
    }

    const tier2 = [...COMPILED_TIER_2, ...compiledMedium];
    for (const p of tier2) {
        if (p.test(file)) return 2;
    }

    return 1;
}

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            encoding: 'utf-8',
        }).trim();
    } catch {
        return 'unknown';
    }
}

export const pulseCommand = new Command('pulse')
    .description('Sync from Colony then show active conflicts (quick health-check)')
    .option('--json', 'Output as JSON')
    .option('--no-sync', 'Skip Colony sync, use local registry only')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const config = await loadConfig();
        const highSeverity = (config.conflicts?.highSeverityPatterns || []).map((p: string) => new RegExp(p));
        const mediumSeverity = (config.conflicts?.mediumSeverityPatterns || []).map((p: string) => new RegExp(p));

        const compiledHigh = compilePatterns(highSeverity);
        const compiledMedium = compilePatterns(mediumSeverity);

        // ── Colony sync ───────────────────────────────────────────────────────
        let colonySynced = 0;
        let colonyOffline = true;

        if (options.sync !== false) {
            const result = await syncFromColony();
            colonySynced = result.synced;
            colonyOffline = result.offline;
        } else {
            console.log('ℹ  Colony sync skipped (--no-sync)');
        }

        // ── Local conflict detection ──────────────────────────────────────────
        const currentBranch = getCurrentBranch();
        const allBranches = await storage.list();
        const target = allBranches.find(b => b.name === currentBranch);

        if (!target) {
            if (options.json) {
                console.log(JSON.stringify({ branch: currentBranch, registered: false, conflicts: [], colonySynced, colonyOffline }));
            } else {
                console.log(`🕷️ Branch "${currentBranch}" is not registered.`);
                console.log('   Run: spidersan register --files "..."');
                if (!colonyOffline) {
                    console.log(`   Colony: synced ${colonySynced} claim(s)`);
                }
            }
            return;
        }

        const targetFilesSet = new Set(target.files);
        const conflicts: Array<{
            branch: string;
            files: string[];
            tier: number;
            agent?: string;
        }> = [];

        for (const branch of allBranches) {
            if (branch.name === currentBranch || branch.status !== 'active') continue;

            const overlapping = branch.files.filter(f => targetFilesSet.has(f));
            if (overlapping.length === 0) continue;

            // Determine max tier for this conflict group
            let maxTier: 1 | 2 | 3 = 1;
            for (const file of overlapping) {
                const tier = classifyTier(file, compiledHigh, compiledMedium);
                if (tier > maxTier) maxTier = tier;
            }

            conflicts.push({
                branch: branch.name,
                files: overlapping,
                tier: maxTier,
                agent: branch.agent,
            });
        }

        conflicts.sort((a, b) => b.tier - a.tier);

        if (options.json) {
            console.log(JSON.stringify({
                branch: currentBranch,
                registered: true,
                conflicts,
                colonySynced,
                colonyOffline,
            }, null, 2));
            return;
        }

        // ── Human-readable output ─────────────────────────────────────────────
        const colonyStatus = colonyOffline
            ? '⚠  offline'
            : `✅ synced ${colonySynced} claim(s)`;

        console.log(`
🕷️ SPIDERSAN PULSE — "${currentBranch}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Colony:    ${colonyStatus}
Branches:  ${allBranches.filter(b => b.status === 'active').length} active
        `.trim());
        console.log('');

        if (conflicts.length === 0) {
            console.log('✅ No conflicts detected. You\'re good to go!');
            return;
        }

        const tierIcons: Record<number, string> = { 1: '🟡', 2: '🟠', 3: '🔴' };
        const tierLabels: Record<number, string> = { 1: 'WARN', 2: 'PAUSE', 3: 'BLOCK' };

        for (const c of conflicts) {
            const icon = tierIcons[c.tier] ?? '🟡';
            const label = tierLabels[c.tier] ?? 'WARN';
            const agentTag = c.agent ? ` [@${c.agent}]` : '';
            console.log(`${icon} TIER ${c.tier} ${label}: ${c.branch}${agentTag}`);
            for (const f of c.files) {
                console.log(`   • ${f}`);
            }
            console.log('');
        }

        const t3 = conflicts.filter(c => c.tier === 3).length;
        const t2 = conflicts.filter(c => c.tier === 2).length;
        const t1 = conflicts.filter(c => c.tier === 1).length;
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📊 Summary: 🔴 ${t3} BLOCK | 🟠 ${t2} PAUSE | 🟡 ${t1} WARN`);
    });
