/**
 * spidersan cleanup
 * 
 * Remove stale branches from the registry.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';

export const cleanupCommand = new Command('cleanup')
    .description('Remove stale branches from registry')
    .option('--days <n>', 'Days threshold', '7')
    .option('--dry-run', 'Show what would be removed without removing')
    .option('--force', 'Also remove branches still marked active')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const days = parseInt(options.days, 10);
        if (!Number.isFinite(days) || days < 0) {
            console.error(`❌ Invalid --days value: ${options.days}`);
            process.exit(1);
        }
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - days);

        const branches = await storage.list();
        const old = branches.filter(b => new Date(b.registeredAt) < threshold);
        // registeredAt is never refreshed, so an old ACTIVE registration usually
        // means in-flight work, not abandonment — deleting it silently blinds
        // conflict detection for every other agent. Skip unless --force.
        const stale = options.force ? old : old.filter(b => b.status !== 'active');
        const skipped = old.length - stale.length;

        if (stale.length === 0) {
            console.log(`🕷️ No stale branches to clean up.${skipped > 0 ? ` (${skipped} active skipped — use --force to include)` : ''}`);
            return;
        }

        if (options.dryRun) {
            console.log(`🕷️ Would remove ${stale.length} stale branch(es):\n`);
            stale.forEach(b => console.log(`  - ${b.name}`));
            if (skipped > 0) console.log(`\n  (${skipped} active branch(es) skipped — use --force to include)`);
            return;
        }

        const removedNames = await storage.cleanup(threshold, !!options.force);
        removedNames.forEach(name => console.log(`  🗑️  Removed: ${name}`));
        if (skipped > 0) console.log(`  (${skipped} active branch(es) skipped — use --force to include)`);
        console.log(`\n🕷️ Cleaned up ${removedNames.length} branch(es).`);
    });
