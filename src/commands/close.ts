/**
 * spidersan close
 * 
 * End session cleanly.
 * "Securing the Web" - the spider rests, but the web holds.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';

function getCurrentBranch(): string | null {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return null;
    }
}

function hasMycmail(): boolean {
    try {
        execSync('which mycmail', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export const closeCommand = new Command('close')
    .description('End session - secure the web, rest well')
    .option('-m, --message <msg>', 'Custom sign-off message')
    .option('--mark-stale', 'Mark your active branches as stale')
    .option('--silent', 'Skip mycmail broadcast')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Minimal output')
    .action(async (options) => {
        const storage = await getStorage();
        const currentBranch = getCurrentBranch();

        const result: {
            currentBranch: string | null;
            activeBranches: Array<{ name: string; agent?: string }>;
            markedStale: string[];
            conflictsResolved: number;
            mycmailCalled: boolean;
        } = {
            currentBranch,
            activeBranches: [],
            markedStale: [],
            conflictsResolved: 0,
            mycmailCalled: false,
        };

        // Get active branches
        if (await storage.isInitialized()) {
            const branches = await storage.list();
            result.activeBranches = branches
                .filter(b => b.status === 'active')
                .map(b => ({ name: b.name, agent: b.agent }));

            // Mark branches as stale if requested
            if (options.markStale) {
                for (const branch of branches) {
                    if (branch.status === 'active') {
                        await storage.update(branch.name, { status: 'abandoned' });
                        result.markedStale.push(branch.name);
                    }
                }
            }
        }

        // Call mycmail close
        if (!options.silent && hasMycmail()) {
            try {
                const msgPart = options.message ? ` -m "${options.message}"` : '';
                execSync(`mycmail close --quiet${msgPart} 2>/dev/null || true`, { encoding: 'utf-8' });
                result.mycmailCalled = true;
            } catch {
                // Ignore mycmail errors
            }
        }

        // JSON output
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        // Quiet output
        if (options.quiet) {
            const staleInfo = result.markedStale.length > 0 ? `, ${result.markedStale.length} secured` : '';
            console.log(`🕷️ Close: ${result.activeBranches.length} threads${staleInfo}`);
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // CEREMONIAL OUTPUT: "Securing the Web"
        // ═══════════════════════════════════════════════════════════

        console.log('');
        console.log('🕷️  Spidersan Resting...');
        console.log('');
        console.log('   ╭─────────────────────────────────────╮');
        console.log('   │  Securing anchor points...          │');
        console.log('   ╰─────────────────────────────────────╯');
        console.log('');

        // Session summary
        console.log('   📋 Session Summary:');
        console.log(`      • ${result.activeBranches.length} thread${result.activeBranches.length !== 1 ? 's' : ''} in the web`);

        if (result.markedStale.length > 0) {
            console.log(`      • ${result.markedStale.length} thread${result.markedStale.length !== 1 ? 's' : ''} secured (marked stale)`);
            for (const branch of result.markedStale.slice(0, 3)) {
                console.log(`        └─ ${branch}`);
            }
            if (result.markedStale.length > 3) {
                console.log(`        └─ ...and ${result.markedStale.length - 3} more`);
            }
        }

        // Notify others
        if (result.mycmailCalled) {
            console.log('');
            console.log('   🔔 Web Watchers Notified');
            if (options.message) {
                console.log(`      └─ "${options.message}"`);
            }
        }

        // Closing ceremony
        console.log('');
        console.log('   💤 The web holds while you rest.');
        console.log('      Next session: spidersan wake');
        console.log('');
        console.log('   ╭─────────────────────────────────────╮');
        console.log('   │  Threads secured. Sweet dreams. 🌙  │');
        console.log('   ╰─────────────────────────────────────╯');
        console.log('');
    });
