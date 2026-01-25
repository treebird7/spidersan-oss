/**
 * spidersan stale
 * 
 * Show branches that haven't been updated recently.
 * With --notify flag: sends notifications to branch owners via mycmail and .pending_task.md updates.
 */

import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import type { Branch } from '../storage/adapter.js';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, appendFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Send notification to agent via mycmail
 */
function notifyAgentViaMycmail(agentId: string, branchName: string, daysOld: number): boolean {
    try {
        const subject = `⚠️ Stale branch: ${branchName}`;
        const message = `Your branch "${branchName}" has been inactive for ${daysOld} days.\n\nActions:\n- Run: spidersan cleanup\n- Or resume work and push updates`;
        
        const result = spawnSync('mycmail', [
            'send',
            agentId,
            subject,
            '--message',
            message
        ], {
            encoding: 'utf-8',
            env: { ...process.env, MYCELIUMAIL_AGENT_ID: 'spidersan' }
        });

        return result.status === 0;
    } catch {
        return false;
    }
}

/**
 * Update agent's .pending_task.md file
 */
function updatePendingTaskFile(agentId: string, branchName: string, daysOld: number): boolean {
    try {
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

        const entry = `- [ ] 🕷️ Stale branch: \`${branchName}\` (${daysOld}d inactive) - run \`spidersan cleanup\`\n`;
        
        // Read file and check if entry already exists
        const content = readFileSync(taskFilePath, 'utf-8');
        if (content.includes(branchName)) {
            return true; // Already notified
        }

        // Append to the file
        appendFileSync(taskFilePath, entry, 'utf-8');
        return true;
    } catch {
        return false;
    }
}

export const staleCommand = new Command('stale')
    .description('Show stale branches (not updated recently)')
    .option('--days <n>', 'Days threshold for staleness', '7')
    .option('--notify', 'Send notifications to branch owners')
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
            
            let mycmailSuccess = 0;
            let fileSuccess = 0;

            for (const [agent, branches] of byAgent) {
                if (agent === 'unknown') continue;

                for (const branch of branches) {
                    const age = Math.floor((Date.now() - new Date(branch.registeredAt).getTime()) / 86400000);
                    
                    // Try mycmail notification
                    if (notifyAgentViaMycmail(agent, branch.name, age)) {
                        mycmailSuccess++;
                    }

                    // Try .pending_task.md update
                    if (updatePendingTaskFile(agent, branch.name, age)) {
                        fileSuccess++;
                    }
                }
            }

            console.log(`✅ Notifications sent:`);
            console.log(`   - Mycmail: ${mycmailSuccess}/${stale.length}`);
            console.log(`   - File updates: ${fileSuccess}/${stale.length}`);
        }

        console.log(`\nRun 'spidersan cleanup' to remove these.`);
    });
