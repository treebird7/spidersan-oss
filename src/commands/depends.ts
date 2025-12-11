/**
 * spidersan depends
 * 
 * Set dependencies between branches.
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

export const dependsCommand = new Command('depends')
    .description('Set or show dependencies for a branch')
    .argument('[branches...]', 'Branches this branch depends on')
    .option('--branch <name>', 'Target branch (default: current)')
    .option('--clear', 'Clear all dependencies')
    .action(async (branches: string[], options) => {
        const storage = new LocalStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = options.branch || getCurrentBranch();
        const branch = await storage.get(branchName);

        if (!branch) {
            console.error(`❌ Branch "${branchName}" is not registered.`);
            process.exit(1);
        }

        // Show current dependencies if no args
        if (branches.length === 0 && !options.clear) {
            // For local storage, we don't have depends_on field
            console.log(`🕷️ Dependencies for "${branchName}":`);
            console.log('   (Local storage doesn\'t track dependencies. Use Supabase for this feature.)');
            return;
        }

        console.log(`🕷️ Dependency tracking requires Supabase storage.`);
        console.log('   Set SUPABASE_URL and SUPABASE_KEY to enable.');
    });
