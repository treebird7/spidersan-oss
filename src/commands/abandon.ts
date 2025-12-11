/**
 * spidersan abandon
 * 
 * Mark a branch as abandoned.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { LocalStorage } from '../storage/index.js';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

export const abandonCommand = new Command('abandon')
    .description('Mark a branch as abandoned')
    .argument('[branch]', 'Branch to abandon (default: current)')
    .option('-f, --force', 'Skip confirmation')
    .action(async (branchArg: string | undefined, options) => {
        const storage = new LocalStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = branchArg || getCurrentBranch();

        const success = await storage.unregister(branchName);

        if (success) {
            console.log(`🕷️ Abandoned: ${branchName}`);
        } else {
            console.error(`❌ Branch "${branchName}" not found in registry.`);
            process.exit(1);
        }
    });
