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
import { renderPulseReport } from '../lib/pulse-renderer.js';
import { computeDriftResult } from '../lib/remote-drift.js';
import type { ConflictTier } from '../lib/conflict-tier.js';
import { isOfflineError } from '../lib/remote-drift.js';
import { probeSmalltoak } from '../lib/smalltoak.js';

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

        // ── Smalltoak bridge health (proactive down-detection, tb-r9s) ────────
        // No-op unless SMALLTOAK_SERVER_URL is set; never throws.
        const smalltoak = await probeSmalltoak();

        // ── Local conflict detection ──────────────────────────────────────────
        const currentBranch = resolveCurrentBranch();
        const allBranches = await storage.list();
        const target = allBranches.find(b => b.name === currentBranch);

        if (!target) {
            if (options.json) {
                const jsonOut: Record<string, unknown> = { branch: currentBranch, registered: false, conflicts: [], colonySynced, colonyOffline, smalltoak };
                if (options.remoteDrift) {
                    const drift = await computeDriftResult([], { remote: 'origin', branch: currentBranch });
                    jsonOut.remoteDrift = 'skipped' in drift ? { skipped: true, reason: drift.reason } : drift;
                }
                console.log(JSON.stringify(jsonOut));
            } else {
                const drift = options.remoteDrift
                    ? await computeDriftResult([], { remote: 'origin', branch: currentBranch })
                    : null;
                console.log(renderPulseReport({
                    branch: currentBranch,
                    registered: false,
                    colonySynced,
                    colonyOffline,
                    conflicts: [],
                    drift,
                    smalltoak,
                }));
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
                smalltoak,
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
        const drift = options.remoteDrift
            ? await computeDriftResult(target.files, { remote: 'origin', branch: currentBranch })
            : null;

        if (drift && !('skipped' in drift) && options.hubSync) {
            const hasRisk = drift.registeredInDrift.length > 0 || drift.unstagedInDrift.length > 0;
            if (hasRisk) {
                const hub = createHubClient();
                const lines = [
                    `🕷️⚠️ Remote drift detected on \`${drift.branch}\``,
                    `  ${drift.remoteAhead} commit(s) ahead | ${drift.registeredInDrift.length} registered file(s) at risk | ${drift.unstagedInDrift.length} rebase-continue blocker(s)`,
                    ...drift.registeredInDrift.map((entry) => `  ${renderTierIcon(entry.tier)} ${entry.file}${entry.unstaged ? '  [also has unstaged modifications]' : ''}`),
                ];
                await hub.postToChat({ agent: 'spidersan', name: 'Spidersan', message: lines.join('\n'), glyph: '🕷️' }).catch((error: unknown) => {
                    if (!isOfflineError(error)) console.warn('Hub sync failed:', error);
                });
            }
        }

        console.log(renderPulseReport({
            branch: currentBranch,
            registered: true,
            colonySynced,
            colonyOffline,
            activeBranches: allBranches.filter((branch) => branch.status === 'active').length,
            conflicts,
            drift,
            smalltoak,
        }));

        if (drift && !('skipped' in drift) && options.strict && (drift.registeredInDrift.length > 0 || drift.unstagedInDrift.length > 0)) {
            process.exit(1);
        }
    });

function renderTierIcon(tier: 1 | 2 | 3 | null): string {
    if (tier === 3) return '🔴';
    if (tier === 2) return '🟠';
    if (tier === 1) return '🟡';
    return '⚪';
}
