/**
 * spidersan depends
 *
 * Set dependencies between branches. A dependency means "that branch must
 * merge before this one" — merge-order folds these edges into its sort.
 * Stored on the registry entry, so it works with local AND Supabase storage
 * (registry-sync pushes `depends_on` cross-machine).
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { getCurrentBranch } from '../lib/git.js';
import { validateBranchName } from '../lib/security.js';

export const dependsCommand = new Command('depends')
    .description('Set or show dependencies for a branch (deps merge first)')
    .argument('[branches...]', 'Branches this branch depends on')
    .option('--branch <name>', 'Target branch (default: current)')
    .option('--clear', 'Clear all dependencies')
    .action(async (branches: string[], options) => {
        const storage = await getStorage();

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

        if (options.clear) {
            await storage.update(branchName, { dependsOn: [] });
            console.log(`🕷️ Cleared dependencies for "${branchName}".`);
            return;
        }

        if (branches.length === 0) {
            const deps = branch.dependsOn ?? [];
            console.log(`🕷️ Dependencies for "${branchName}":`);
            if (deps.length === 0) {
                console.log('   (none)');
            } else {
                for (const dep of deps) console.log(`   ← ${dep}`);
            }
            return;
        }

        const deps: string[] = [];
        for (const dep of branches) {
            const safe = validateBranchName(dep);
            if (safe === branchName) {
                console.error(`❌ "${branchName}" cannot depend on itself.`);
                process.exit(1);
            }
            if (!(await storage.get(safe))) {
                console.log(`   ⚠️  "${safe}" is not registered (recorded anyway — register it so merge-order can see it)`);
            }
            deps.push(safe);
        }

        await storage.update(branchName, { dependsOn: [...new Set(deps)] });
        console.log(`🕷️ "${branchName}" now depends on: ${deps.join(', ')}`);
        console.log('   These merge first in `spidersan merge-order`.');
    });
