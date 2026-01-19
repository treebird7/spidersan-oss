/**
 * spidersan stale
 * 
 * Show branches that haven't been updated recently.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import type { Branch } from '../storage/adapter.js';

export const staleCommand = new Command('stale')
    .description('Show stale branches (not updated recently)')
    .option('--days <n>', 'Days threshold for staleness', '7')
    .option('--json', 'Output as JSON')
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

        if (options.json) {
            console.log(JSON.stringify(stale, null, 2));
            return;
        }

        if (stale.length === 0) {
            console.log(`🕷️ No stale branches (older than ${days} days)`);
            return;
        }

        console.log(`🕷️ Stale Branches (>${days} days old):\n`);

        for (const branch of stale) {
            const age = Math.floor((Date.now() - new Date(branch.registeredAt).getTime()) / 86400000);
            console.log(`  ⚠️  ${branch.name} (${age} days old)`);
        }

        console.log(`\nRun 'spidersan cleanup' to remove these.`);
    });
