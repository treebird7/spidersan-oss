/**
 * spidersan merged
 * 
 * Mark a branch as merged.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

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

        console.log(`🕷️ Marked as merged: ${branchName}`);
        if (options.pr) {
            console.log(`   PR: #${options.pr}`);
        }
    });
