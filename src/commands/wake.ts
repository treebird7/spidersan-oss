/**
 * spidersan wake
 * 
 * Start a session with branch context.
 * "Weaving into the Web" - the spider feels its threads.
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

function getInboxCount(): number {
    try {
        const output = execSync('mycmail inbox --count 2>/dev/null || echo "0"', { encoding: 'utf-8' });
        const match = output.match(/(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
    } catch {
        return 0;
    }
}

export const wakeCommand = new Command('wake')
    .description('Start a session - weave into the web, feel the threads')
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Minimal output')
    .option('--skip-mail', 'Skip mycmail integration')
    .action(async (options) => {
        const storage = await getStorage();
        const currentBranch = getCurrentBranch();
        const result: {
            synced: number;
            branches: Array<{ name: string; files: string[]; status: string; agent?: string }>;
            conflicts: Array<{ branch: string; files: string[]; agent?: string }>;
            inboxCount: number;
            mycmailCalled: boolean;
        } = {
            synced: 0,
            branches: [],
            conflicts: [],
            inboxCount: 0,
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
                .map(b => ({ name: b.name, files: b.files, status: b.status, agent: b.agent }));

            // Step 2: Check conflicts for current branch
            if (currentBranch) {
                const target = await storage.get(currentBranch);
                if (target) {
                    for (const branch of branches) {
                        if (branch.name === currentBranch || branch.status !== 'active') continue;
                        const overlappingFiles = branch.files.filter(f => target.files.includes(f));
                        if (overlappingFiles.length > 0) {
                            result.conflicts.push({ branch: branch.name, files: overlappingFiles, agent: branch.agent });
                        }
                    }
                }
            }
        }

        // Step 3: Call mycmail wake
        if (!options.skipMail && hasMycmail()) {
            try {
                execSync('mycmail wake --quiet 2>/dev/null || true', { encoding: 'utf-8' });
                result.mycmailCalled = true;
                result.inboxCount = getInboxCount();
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
            console.log(`🕷️ Wake: ${result.branches.length} threads, ${result.conflicts.length} tensions`);
            return;
        }

        // ═══════════════════════════════════════════════════════════
        // CEREMONIAL OUTPUT: "Weaving into the Web"
        // ═══════════════════════════════════════════════════════════

        console.log('');
        console.log('🕷️  Spidersan Awakens...');
        console.log('');
        console.log('   ╭─────────────────────────────────────╮');
        console.log('   │  Feeling the threads...             │');
        console.log('   ╰─────────────────────────────────────╯');
        console.log('');

        // Web status
        const agentCount = new Set(result.branches.map(b => b.agent).filter(Boolean)).size;
        console.log('   📡 Web Status:');
        console.log(`      • ${result.branches.length} thread${result.branches.length !== 1 ? 's' : ''} active`);
        if (agentCount > 0) {
            console.log(`      • ${agentCount} agent${agentCount !== 1 ? 's' : ''} weaving`);
        }
        if (result.synced > 0) {
            console.log(`      • ${result.synced} broken thread${result.synced !== 1 ? 's' : ''} cleared`);
        }

        // Tensions (conflicts)
        if (result.conflicts.length > 0) {
            console.log('');
            console.log(`   ⚠️  Tension${result.conflicts.length !== 1 ? 's' : ''} detected:`);
            for (const conflict of result.conflicts) {
                const agentInfo = conflict.agent ? ` (${conflict.agent})` : '';
                console.log(`      └─ ${conflict.files[0]}${agentInfo}`);
                if (conflict.files.length > 1) {
                    console.log(`         +${conflict.files.length - 1} more file${conflict.files.length > 2 ? 's' : ''}`);
                }
            }
        }

        // Active threads
        if (result.branches.length > 0) {
            console.log('');
            console.log('   🕸️  Active Threads:');
            for (const branch of result.branches.slice(0, 4)) {
                const isCurrent = branch.name === currentBranch ? ' ← you' : '';
                const agentInfo = branch.agent && branch.name !== currentBranch ? ` (${branch.agent})` : '';
                console.log(`      • ${branch.name}${agentInfo}${isCurrent}`);
            }
            if (result.branches.length > 4) {
                console.log(`      • ...and ${result.branches.length - 4} more`);
            }
        }

        // Messages
        if (result.mycmailCalled) {
            console.log('');
            if (result.inboxCount > 0) {
                console.log(`   📬 ${result.inboxCount} message${result.inboxCount !== 1 ? 's' : ''} waiting`);
            } else {
                console.log('   📭 No new messages');
            }
        }

        // Closing
        console.log('');
        if (result.conflicts.length === 0) {
            console.log('   ╭─────────────────────────────────────╮');
            console.log('   │  The web is calm. Ready to hunt. 🎯 │');
            console.log('   ╰─────────────────────────────────────╯');
        } else {
            console.log('   ╭─────────────────────────────────────╮');
            console.log('   │  Tensions on the web. Tread softly. │');
            console.log('   ╰─────────────────────────────────────╯');
        }
        console.log('');
    });
