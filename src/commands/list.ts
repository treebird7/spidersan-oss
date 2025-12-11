/**
 * spidersan list
 * 
 * List all registered branches.
 */

import { Command } from 'commander';
import { LocalStorage } from '../storage/index.js';

export const listCommand = new Command('list')
    .description('List all registered branches')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const storage = new LocalStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branches = await storage.list();

        if (branches.length === 0) {
            console.log('🕷️ No branches registered yet.');
            console.log('   Run: spidersan register --files "src/foo.ts"');
            return;
        }

        if (options.json) {
            console.log(JSON.stringify(branches, null, 2));
            return;
        }

        console.log('🕷️ Registered Branches:\n');

        for (const branch of branches) {
            const status = branch.status === 'active' ? '🔄' :
                branch.status === 'completed' ? '✅' : '❌';
            const ago = getTimeAgo(new Date(branch.registeredAt));

            console.log(`  ${status} ${branch.name}`);
            console.log(`     └─ ${ago}${branch.agent ? ` | ${branch.agent}` : ''}`);

            if (branch.files.length > 0) {
                console.log(`     └─ Files: ${branch.files.slice(0, 3).join(', ')}${branch.files.length > 3 ? ` (+${branch.files.length - 3} more)` : ''}`);
            }
            console.log('');
        }
    });

function getTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}
