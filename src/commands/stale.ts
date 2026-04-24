/**
 * spidersan stale
 * 
 * Show branches that haven't been updated recently.
 * With --notify flag: sends notifications to branch owners via .pending_task.md updates.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import type { Branch } from '../storage/adapter.js';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import { validateAgentId, validateBranchName } from '../lib/security.js';

/**
 * Update agent's .pending_task.md file
 * ⚡ Bolt: Batched updates to avoid N+1 file I/O
 */
export function updatePendingTaskFile(agentId: string, branches: { name: string; daysOld: number }[]): boolean {
    if (branches.length === 0) return true;

    try {
        // Security: Validate inputs
        validateAgentId(agentId);
        for (const b of branches) {
            validateBranchName(b.name);
        }

        // Try common locations for .pending_task.md
        const possiblePaths = [
            resolve(process.cwd(), '.pending_task.md'),
            resolve(process.cwd(), `../${agentId}/.pending_task.md`),
            resolve(process.env.HOME || '~', `Dev/${agentId}/.pending_task.md`),
            resolve(process.env.HOME || '~', 'Dev/treebird-internal/.pending_task.md')
        ];

        let taskFilePath: string | null = null;
        for (const path of possiblePaths) {
            if (existsSync(path)) {
                taskFilePath = path;
                break;
            }
        }

        if (!taskFilePath) {
            return false;
        }

        const content = readFileSync(taskFilePath, 'utf-8');
        let newEntries = '';

        for (const b of branches) {
            // Check if entry already exists
            if (!content.includes(b.name)) {
                newEntries += `- [ ] 🕷️ Stale branch: \`${b.name}\` (${b.daysOld}d inactive) - run \`spidersan cleanup\`\n`;
            }
        }

        if (newEntries.length > 0) {
            appendFileSync(taskFilePath, newEntries, 'utf-8');
        }

        return true;
    } catch {
        return false;
    }
}

export const staleCommand = new Command('stale')
    .description('Show stale branches (not updated recently)')
    .option('--days <n>', 'Days threshold for staleness', '7')
    .option('--notify', 'Send notifications to branch owners')
    .option('--auto-cleanup', 'Automatically remove stale branches after listing')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const days = parseInt(options.days, 10);
        const threshold = new Date();
        threshold.setDate(threshold.getDate() - days);

        const branches = await storage.list();
        const stale = branches.filter(b => new Date(b.registeredAt) < threshold);

        // Group by agent if notifying
        const byAgent = new Map<string, Branch[]>();
        if (options.notify) {
            for (const branch of stale) {
                const agent = branch.agent || 'unknown';
                if (!byAgent.has(agent)) {
                    byAgent.set(agent, []);
                }
                byAgent.get(agent)!.push(branch);
            }
        }

        if (options.json) {
            console.log(JSON.stringify(stale, null, 2));
            return;
        }

        if (stale.length === 0) {
            console.log(`🕷️ No stale branches (older than ${days} days)`);
            return;
        }

        console.log(`🕷️ Stale Branches (>${days} days old):\n`);

        for (const branch of stale) {
            const age = Math.floor((Date.now() - new Date(branch.registeredAt).getTime()) / 86400000);
            const agentTag = branch.agent ? ` [@${branch.agent}]` : '';
            console.log(`  ⚠️  ${branch.name}${agentTag} (${age} days old)`);
        }

        // Send notifications if requested
        if (options.notify) {
            console.log(`\n📨 Sending notifications...`);
            
            let fileSuccess = 0;

            for (const [agent, branches] of byAgent) {
                if (agent === 'unknown') continue;

                // ⚡ Bolt: Batch notification per agent to avoid N+1 slow calls
                const branchData = branches.map(branch => ({
                    name: branch.name,
                    daysOld: Math.floor((Date.now() - new Date(branch.registeredAt).getTime()) / 86400000)
                }));

                // Try .pending_task.md update
                if (updatePendingTaskFile(agent, branchData)) {
                    fileSuccess += branches.length;
                }
            }

            console.log(`✅ Notifications sent:`);
            console.log(`   - File updates: ${fileSuccess}/${stale.length}`);
        }

        if (options.autoCleanup) {
            console.log(`\n🗑️  Auto-cleaning ${stale.length} stale branch(es)...`);
            const removedNames = await storage.cleanup(threshold);
            removedNames.forEach(name => console.log(`   Removed: ${name}`));
            console.log(`✅ Cleaned up ${removedNames.length} branch(es).`);
        } else {
            console.log(`\nRun 'spidersan cleanup' to remove these.`);
        }
    });
