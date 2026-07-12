/**
 * spidersan sync
 *
 * Reconcile the local registry against git truth and prune dead entries.
 *
 * Prunes BOTH:
 *   - orphaned — branch ref gone from local and remote
 *   - merged   — branch tip is an ancestor of trunk (or status `completed`)
 *
 * Previously sync only removed orphans, so a merged branch lingered in the
 * registry forever and kept producing phantom conflicts (tb-8sa.1 / §1.2).
 * Merged entries are now deleted, not just marked.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { logActivity } from '../lib/activity.js';
import { reconcileBranches } from '../lib/reconcile.js';

export const syncCommand = new Command('sync')
    .description('Sync registry with actual git branches')
    .option('--dry-run', 'Show what would be synced without syncing')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const { merged, orphaned } = reconcileBranches(await storage.list());
        const stale = [
            ...merged.map(name => ({ name, reason: 'merged' as const })),
            ...orphaned.map(name => ({ name, reason: 'orphaned' as const })),
        ];

        if (stale.length === 0) {
            console.log('🕷️ Registry is in sync with git.');
            logActivity({ event: 'sync', details: { merged: 0, orphaned: 0, action: 'clean' } });
            return;
        }

        console.log(`🕷️ Found ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'} (${merged.length} merged, ${orphaned.length} orphaned):\n`);

        let failed = 0;
        for (const { name, reason } of stale) {
            if (options.dryRun) {
                console.log(`  Would remove (${reason}): ${name}`);
            } else if (await storage.unregister(name)) {
                console.log(`  🗑️  Removed (${reason}): ${name}`);
                logActivity({ event: 'sync', branch: name, details: { action: `removed_${reason}` } });
            } else {
                // Don't claim "Removed" for a no-op — a delete that misses means
                // the entry vanished mid-sync or the registry is corrupt (tb-orpt).
                failed++;
                console.log(`  ⚠️  Could not remove (${reason}): ${name} — not found in registry`);
                logActivity({ event: 'sync', branch: name, details: { action: `remove_failed_${reason}` } });
            }
        }

        if (!options.dryRun) {
            if (failed > 0) {
                console.log(`\n⚠️  Synced with ${failed} failed removal${failed === 1 ? '' : 's'} — registry may be corrupt (check .spidersan/registry.json).`);
                process.exit(1);
            }
            console.log(`\n✅ Synced registry with git.`);
        }
    });
