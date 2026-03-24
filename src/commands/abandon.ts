/**
 * spidersan abandon
 * 
 * Mark a branch as abandoned.
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { logActivity } from '../lib/activity.js';

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

export const abandonCommand = new Command('abandon')
    .description('Mark a branch as abandoned')
    .argument('[branch]', 'Branch to abandon (default: current)')
    .option('-f, --force', 'Skip confirmation')
    .option('--dry-run', 'Show what would be abandoned without doing it')
    .action(async (branchArg: string | undefined, options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = branchArg || getCurrentBranch();

        // Check if branch exists
        const branch = await storage.get(branchName);
        if (!branch) {
            console.error(`❌ Branch "${branchName}" not found in registry.`);
            process.exit(1);
        }

        if (options.dryRun) {
            console.log(`🕷️ Would abandon: ${branchName}`);
            console.log(`   Files: ${branch.files.join(', ') || 'none'}`);
            return;
        }

        const success = await storage.unregister(branchName);

        if (success) {
            logActivity({ event: 'abandon', branch: branchName, details: {} });
            console.log(`🕷️ Abandoned: ${branchName}`);
        } else {
            console.error(`❌ Failed to abandon "${branchName}".`);
            process.exit(1);
        }
    });
