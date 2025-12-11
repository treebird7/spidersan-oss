/**
 * spidersan init
 * 
 * Initialize Spidersan in the current project.
 */

import { Command } from 'commander';
import { LocalStorage } from '../storage/index.js';

export const initCommand = new Command('init')
    .description('Initialize Spidersan in the current project')
    .action(async () => {
        const storage = new LocalStorage();

        if (await storage.isInitialized()) {
            console.log('🕷️ Spidersan is already initialized in this project.');
            return;
        }

        await storage.init();
        console.log('🕷️ Spidersan initialized!');
        console.log('   Created .spidersan/registry.json');
        console.log('');
        console.log('Next steps:');
        console.log('  spidersan register --files "src/foo.ts,lib/bar.ts"');
    });
