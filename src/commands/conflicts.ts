/**
 * spidersan conflicts
 * 
 * Detect file conflicts between branches.
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

export const conflictsCommand = new Command('conflicts')
    .description('Detect file conflicts between branches')
    .option('--branch <name>', 'Check conflicts for specific branch')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const targetBranch = options.branch || getCurrentBranch();
        const target = await storage.get(targetBranch);

        if (!target) {
            console.error(`❌ Branch "${targetBranch}" is not registered.`);
            console.error('   Run: spidersan register --files "..."');
            process.exit(1);
        }

        const allBranches = await storage.list();
        const conflicts: Array<{ branch: string; files: string[] }> = [];

        for (const branch of allBranches) {
            if (branch.name === targetBranch) continue;

            const overlappingFiles = branch.files.filter(f => target.files.includes(f));
            if (overlappingFiles.length > 0) {
                conflicts.push({ branch: branch.name, files: overlappingFiles });
            }
        }

        if (options.json) {
            console.log(JSON.stringify({ branch: targetBranch, conflicts }, null, 2));
            return;
        }

        if (conflicts.length === 0) {
            console.log(`🕷️ No conflicts detected for "${targetBranch}"`);
            console.log('   ✅ You\'re good to merge!');
            return;
        }

        console.log(`🕷️ Conflicts for "${targetBranch}":\n`);

        for (const conflict of conflicts) {
            console.log(`  ⚠️  ${conflict.branch}`);
            for (const file of conflict.files) {
                console.log(`      └─ ${file}`);
            }
            console.log('');
        }

        console.log(`Found ${conflicts.length} conflicting branch(es).`);
        console.log('Consider rebasing or coordinating with other agents.');
    });
