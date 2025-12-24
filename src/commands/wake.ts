/**
 * spidersan wake
 * 
 * Start a session with branch context.
 * Syncs registry, shows active branches, checks conflicts, calls mycmail wake.
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

function getGitBranches(): string[] {
    try {
        const output = execSync('git branch --format="%(refname:short)"', { encoding: 'utf-8' });
        return output.trim().split('\n').filter(Boolean);
    } catch {
        return [];
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

export const wakeCommand = new Command('wake')
    .description('Start a session - sync registry, check conflicts, announce presence')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Minimal output')
    .option('--skip-mail', 'Skip mycmail integration')
    .action(async (options) => {
        const storage = await getStorage();
        const currentBranch = getCurrentBranch();
        const result: {
            synced: number;
            branches: Array<{ name: string; files: string[]; status: string }>;
            conflicts: Array<{ branch: string; files: string[] }>;
            inbox: string | null;
            mycmailCalled: boolean;
        } = {
            synced: 0,
            branches: [],
            conflicts: [],
            inbox: null,
            mycmailCalled: false,
        };

        // Step 1: Sync registry with git (remove orphaned branches)
        if (await storage.isInitialized()) {
            const gitBranches = new Set(getGitBranches());
            const registeredBranches = await storage.list();

            for (const branch of registeredBranches) {
                if (!gitBranches.has(branch.name) && branch.status === 'active') {
                    await storage.unregister(branch.name);
                    result.synced++;
                }
            }

            // Get current branches after sync
            const branches = await storage.list();
            result.branches = branches
                .filter(b => b.status === 'active')
                .map(b => ({ name: b.name, files: b.files, status: b.status }));

            // Step 2: Check conflicts for current branch
            if (currentBranch) {
                const target = await storage.get(currentBranch);
                if (target) {
                    for (const branch of branches) {
                        if (branch.name === currentBranch || branch.status !== 'active') continue;
                        const overlappingFiles = branch.files.filter(f => target.files.includes(f));
                        if (overlappingFiles.length > 0) {
                            result.conflicts.push({ branch: branch.name, files: overlappingFiles });
                        }
                    }
                }
            }
        }

        // Step 3: Call mycmail wake
        if (!options.skipMail && hasMycmail()) {
            try {
                const output = execSync('mycmail wake --quiet 2>/dev/null || true', { encoding: 'utf-8' });
                result.inbox = output.trim() || null;
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
            console.log(`🕷️ Wake: ${result.branches.length} branches, ${result.conflicts.length} conflicts`);
            return;
        }

        // Full output
        console.log('🕷️ Spidersan Wake\n');

        if (result.synced > 0) {
            console.log(`   🔄 Synced: Removed ${result.synced} orphaned branch(es)`);
        }

        if (currentBranch) {
            console.log(`   📍 Current branch: ${currentBranch}`);
        }

        if (result.branches.length > 0) {
            console.log(`\n   📋 Active Branches (${result.branches.length}):`);
            for (const branch of result.branches.slice(0, 5)) {
                const isCurrent = branch.name === currentBranch ? ' ← you' : '';
                console.log(`      • ${branch.name}${isCurrent}`);
            }
            if (result.branches.length > 5) {
                console.log(`      ... and ${result.branches.length - 5} more`);
            }
        } else {
            console.log('\n   📋 No active branches registered');
        }

        if (result.conflicts.length > 0) {
            console.log(`\n   ⚠️  Conflicts (${result.conflicts.length}):`);
            for (const conflict of result.conflicts) {
                console.log(`      • ${conflict.branch}: ${conflict.files.join(', ')}`);
            }
        } else if (currentBranch && result.branches.some(b => b.name === currentBranch)) {
            console.log('\n   ✅ No conflicts with other branches');
        }

        if (result.mycmailCalled) {
            console.log('\n   📬 Myceliumail: Session started');
        } else if (!options.skipMail && !hasMycmail()) {
            console.log('\n   💡 Install mycmail for messaging: npm i -g myceliumail');
        }

        console.log('\n   Ready to work! 🕷️');
    });
