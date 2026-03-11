/**
 * spidersan sync
 * 
 * Sync local registry with git state.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { logActivity } from '../lib/activity.js';

function getGitBranches(): string[] {
    try {
        const output = execSync('git branch --format="%(refname:short)"', { encoding: 'utf-8' });
        return output.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

export const syncCommand = new Command('sync')
    .description('Sync registry with actual git branches')
    .option('--dry-run', 'Show what would be synced without syncing')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const gitBranches = new Set(getGitBranches());
        const registeredBranches = await storage.list();

        // Find branches in registry but not in git
        const orphaned = registeredBranches.filter(b => !gitBranches.has(b.name));

        if (orphaned.length === 0) {
            console.log('🕷️ Registry is in sync with git.');
            logActivity({ event: 'sync', details: { orphaned: 0, action: 'clean' } });
            return;
        }

        console.log(`🕷️ Found ${orphaned.length} orphaned branch(es):\n`);

        for (const branch of orphaned) {
            if (options.dryRun) {
                console.log(`  Would remove: ${branch.name}`);
            } else {
                await storage.unregister(branch.name);
                console.log(`  🗑️  Removed: ${branch.name}`);
                logActivity({ event: 'sync', branch: branch.name, details: { action: 'removed_orphan' } });
            }
        }

        if (!options.dryRun) {
            console.log(`\n✅ Synced registry with git.`);
        }
    });
