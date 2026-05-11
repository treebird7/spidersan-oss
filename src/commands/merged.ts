/**
 * spidersan merged
 * 
 * Mark a branch as merged.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { logActivity } from '../lib/activity.js';
import { getCurrentBranch } from '../lib/git.js';

export const mergedCommand = new Command('merged')
    .description('Mark a branch as merged')
    .argument('[branch]', 'Branch that was merged (default: current)')
    .option('--pr <number>', 'PR number for tracking')
    .action(async (branchArg: string | undefined, options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = branchArg || getCurrentBranch();
        const branch = await storage.get(branchName);

        if (!branch) {
            console.error(`❌ Branch "${branchName}" not found in registry.`);
            process.exit(1);
        }

        await storage.update(branchName, { status: 'completed' });
        logActivity({ event: 'merge', branch: branchName, agent: branch.agent ?? undefined, details: { pr_number: options.pr } });

        console.log(`🕷️ Marked as merged: ${branchName}`);
        if (options.pr) {
            console.log(`   PR: #${options.pr}`);
        }
    });
