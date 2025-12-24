/**
 * spidersan close
 * 
 * End session cleanly.
 * Shows status, optionally marks branches stale, calls mycmail close.
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
    .description('End session - show status, optionally mark stale, broadcast sign-off')
    .option('-m, --message <msg>', 'Custom sign-off message')
    .option('--mark-stale', 'Mark your active branches as stale')
    .option('--silent', 'Skip mycmail broadcast')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Minimal output')
    .action(async (options) => {
        const storage = await getStorage();
        const currentBranch = getCurrentBranch();
        const agentId = process.env.SPIDERSAN_AGENT || process.env.MYCELIUMAIL_AGENT_ID || 'unknown';

        const result: {
            currentBranch: string | null;
            activeBranches: string[];
            markedStale: string[];
            mycmailCalled: boolean;
        } = {
            currentBranch,
            activeBranches: [],
            markedStale: [],
            mycmailCalled: false,
        };

        // Get active branches
        if (await storage.isInitialized()) {
            const branches = await storage.list();
            result.activeBranches = branches
                .filter(b => b.status === 'active')
                .map(b => b.name);

            // Mark branches as stale if requested
            if (options.markStale) {
                for (const branch of branches) {
                    if (branch.status === 'active') {
                        // Update branch to mark as abandoned/stale
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

        // Output
        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        if (options.quiet) {
            const staleInfo = result.markedStale.length > 0 ? `, ${result.markedStale.length} marked stale` : '';
            console.log(`🕷️ Close: ${result.activeBranches.length} active branches${staleInfo}`);
            return;
        }

        // Full output
        console.log('🕷️ Spidersan Close\n');

        if (currentBranch) {
            console.log(`   📍 Current branch: ${currentBranch}`);
        }

        if (result.activeBranches.length > 0) {
            console.log(`\n   📋 Active Branches (${result.activeBranches.length}):`);
            for (const branch of result.activeBranches.slice(0, 5)) {
                const wasMarked = result.markedStale.includes(branch) ? ' → stale' : '';
                console.log(`      • ${branch}${wasMarked}`);
            }
            if (result.activeBranches.length > 5) {
                console.log(`      ... and ${result.activeBranches.length - 5} more`);
            }
        } else {
            console.log('\n   📋 No active branches to close');
        }

        if (result.markedStale.length > 0) {
            console.log(`\n   🗑️  Marked ${result.markedStale.length} branch(es) as stale`);
        }

        if (result.mycmailCalled) {
            console.log('\n   📬 Myceliumail: Session closed');
            if (options.message) {
                console.log(`      Message: "${options.message}"`);
            }
        } else if (!options.silent && !hasMycmail()) {
            console.log('\n   💡 Install mycmail for messaging: npm i -g myceliumail');
        }

        console.log('\n   Session ended. See you next time! 🕷️');
    });
