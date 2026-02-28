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
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const days = parseInt(options.days, 10);
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - days);

        const branches = await storage.list();
        const stale = branches.filter(b => new Date(b.registeredAt) < threshold);

        if (stale.length === 0) {
            console.log(`🕷️ No stale branches to clean up.`);
            return;
        }

        if (options.dryRun) {
            console.log(`🕷️ Would remove ${stale.length} stale branch(es):\n`);
            stale.forEach(b => console.log(`  - ${b.name}`));
            return;
        }

        // Optimization: Use bulk cleanup instead of N+1 unregister calls
        const removedNames = await storage.cleanup(threshold);
        if (removedNames.length > 0) {
            removedNames.forEach(name => console.log(`  🗑️  Removed: ${name}`));
        }

        console.log(`\n🕷️ Cleaned up ${removedNames.length} branch(es).`);
    });
