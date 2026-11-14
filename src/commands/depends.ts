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
import { findDeclaredCycles } from '../lib/graph.js';

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

        const newDeps = [...new Set(deps)];

        // Write-time cycle check on the raw declared edges, with this branch's
        // list replaced by the new one. Nothing is written if it closes a cycle.
        const all = await storage.list();
        const proposed = [
            ...all.filter((b) => b.name !== branchName).map((b) => ({ name: b.name, dependsOn: b.dependsOn ?? [] })),
            { name: branchName, dependsOn: newDeps },
        ];
        // Only cycles this write closes: a pre-existing cycle elsewhere must not
        // block every unrelated `depends` call (merge-order --critical-path reports those).
        const cycles = findDeclaredCycles(proposed).filter((cycle) =>
            cycle.some((edge) => edge.dependent === branchName));
        if (cycles.length > 0) {
            console.error(`❌ Refusing: this would create a dependency cycle (nothing written):`);
            for (const edge of cycles.flat()) {
                console.error(`   ${edge.dependent} depends on ${edge.dependency}`);
            }
            console.error(`   Break it with: spidersan depends --clear --branch ${branchName}`);
            process.exit(1);
        }

        await storage.update(branchName, { dependsOn: newDeps });
        console.log(`🕷️ "${branchName}" now depends on: ${deps.join(', ')}`);
        console.log('   These merge first in `spidersan merge-order`.');
    });
