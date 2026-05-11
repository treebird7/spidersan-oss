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
import { getStorage } from '../storage/index.js';
import { syncFromColony } from '../lib/colony-subscriber.js';
import { loadConfig } from '../lib/config.js';
import { classifyTier } from '../lib/conflict-tier.js';
import { getCurrentBranch } from '../lib/git.js';
import { createHubClient } from '../lib/hub.js';
import { computeDriftResult } from '../lib/remote-drift.js';
import type { ConflictTier } from '../lib/conflict-tier.js';
import type { DriftResult } from '../lib/remote-drift.js';

function resolveCurrentBranch(): string {
    try {
        return getCurrentBranch();
    } catch {
        return 'unknown';
    }
}

export const pulseCommand = new Command('pulse')
    .description('Sync from Colony then show active conflicts (quick health-check)')
    .option('--json', 'Output as JSON')
    .option('--no-sync', 'Skip Colony sync, use local registry only')
    .option('--remote-drift', 'Check if remote has advanced past local HEAD')
    .option('--hub-sync', 'Post drift alert to Hub if registered or unstaged files are in drift zone')
    .option('--strict', 'Exit 1 if any registered or unstaged files are in the drift zone')
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
        const currentBranch = resolveCurrentBranch();
        const allBranches = await storage.list();
        const target = allBranches.find(b => b.name === currentBranch);

        if (!target) {
            if (options.json) {
                const jsonOut: Record<string, unknown> = { branch: currentBranch, registered: false, conflicts: [], colonySynced, colonyOffline };
                if (options.remoteDrift) {
                    const drift = await computeDriftResult([], { remote: 'origin', branch: currentBranch });
                    jsonOut.remoteDrift = 'skipped' in drift ? { skipped: true, reason: drift.reason } : drift;
                }
                console.log(JSON.stringify(jsonOut));
            } else {
                console.log(`🕷️ Branch "${currentBranch}" is not registered.`);
                console.log('   Run: spidersan register --files "..."');
                if (!colonyOffline) {
                    console.log(`   Colony: synced ${colonySynced} claim(s)`);
                }
                if (options.remoteDrift) {
                    console.log('');
                    const drift = await computeDriftResult([], { remote: 'origin', branch: currentBranch });
                    if ('skipped' in drift) {
                        console.log(`⚠  Remote drift check skipped: ${drift.reason}`);
                    } else {
                        printDriftReport(drift);
                    }
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
            let maxTier: ConflictTier = 1;
            for (const file of overlapping) {
                const tier = classifyTier(file, {
                    extraTier3: compiledHigh,
                    extraTier2: compiledMedium,
                });
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
            const jsonOutput: Record<string, unknown> = {
                branch: currentBranch,
                registered: true,
                conflicts,
                colonySynced,
                colonyOffline,
            };

            if (options.remoteDrift) {
                const drift = await computeDriftResult(target?.files ?? [], { remote: 'origin', branch: currentBranch });
                if ('skipped' in drift) {
                    jsonOutput.remoteDrift = { skipped: true, reason: drift.reason };
                } else {
                    jsonOutput.remoteDrift = drift;
                }
            }

            console.log(JSON.stringify(jsonOutput, null, 2));
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
        } else {
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
        }

        // ── Remote drift section ──────────────────────────────────────────────
        if (options.remoteDrift) {
            console.log('');
            const drift = await computeDriftResult(target?.files ?? [], { remote: 'origin', branch: currentBranch });

            if ('skipped' in drift) {
                console.log(`⚠  Remote drift check skipped: ${drift.reason}`);
            } else {
                printDriftReport(drift);

                if (options.hubSync) {
                    const hasRisk = drift.registeredInDrift.length > 0 || drift.unstagedInDrift.length > 0;
                    if (hasRisk) {
                        const hub = createHubClient();
                        const lines = [
                            `🕷️⚠️ Remote drift detected on \`${drift.branch}\``,
                            `  ${drift.remoteAhead} commit(s) ahead | ${drift.registeredInDrift.length} registered file(s) at risk | ${drift.unstagedInDrift.length} rebase-continue blocker(s)`,
                            ...drift.registeredInDrift.map(e => `  ${tierIcon(e.tier)} ${e.file}${e.unstaged ? '  [also has unstaged modifications]' : ''}`),
                        ];
                        await hub.postToChat({ agent: 'spidersan', name: 'Spidersan', message: lines.join('\n'), glyph: '🕷️' }).catch(() => {/* offline-graceful */});
                    }
                }

                if (options.strict && (drift.registeredInDrift.length > 0 || drift.unstagedInDrift.length > 0)) {
                    process.exit(1);
                }
            }
        }
    });

function tierIcon(tier: 1 | 2 | 3 | null): string {
    if (tier === 3) return '🔴';
    if (tier === 2) return '🟠';
    if (tier === 1) return '🟡';
    return '⚪';
}

function printDriftReport(drift: DriftResult): void {
    if (drift.state === 'synced' || drift.remoteAhead === 0) {
        console.log('✅ Remote drift: 0 commits ahead. Safe to push.');
        return;
    }

    const tierLabels: Record<number, string> = { 1: 'TIER 1', 2: 'TIER 2', 3: 'TIER 3' };

    console.log(`🕷️ REMOTE DRIFT — "${drift.branch}"`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Remote is ${drift.remoteAhead} commit(s) ahead of local.`);
    console.log('');
    console.log('Drift zone (files touched by remote commits):');

    for (const entry of drift.driftZone.map(file => {
        const found = [...drift.registeredInDrift, ...drift.unstagedInDrift].find(e => e.file === file);
        return found ?? { file, registered: false, tier: null as null, unstaged: false };
    })) {
        const parts: string[] = [];
        if (entry.registered && entry.tier !== null) {
            parts.push(`registered — ${tierIcon(entry.tier)} ${tierLabels[entry.tier]}`);
        }
        if (entry.unstaged) {
            parts.push('unstaged modification ⚠');
        }
        const label = parts.length > 0 ? `  [${parts.join('] [')}]` : '  [not registered, not modified]';
        console.log(`  ${entry.file}${label}`);
    }

    console.log('');

    if (drift.registeredInDrift.length > 0) {
        console.log(`⚠  ${drift.registeredInDrift.length} registered file(s) in drift zone. Rebase will conflict.`);
    }
    if (drift.rebaseContinueRisk) {
        const blockers = drift.unstagedInDrift.map(e => e.file);
        console.log('⚠  File(s) with unstaged modifications — git rebase --continue may block even');
        console.log('   after resolving conflict markers. Fix: git checkout HEAD -- <file>');
        for (const f of blockers) {
            console.log(`     ${f}`);
        }
    }

    console.log('');
    console.log(`   git fetch origin`);
    console.log(`   git log --oneline ${drift.remote} -3`);
}
