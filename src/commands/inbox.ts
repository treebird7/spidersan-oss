import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { validateAgentId } from '../lib/security.js';

export const inboxCommand = new Command('inbox')
    .description('View messages sent to you (via Myceliumail)')
    .option('-a, --agent <id>', 'Agent identifier (default: SPIDERSAN_AGENT env or "cli-agent")')
    .option('-u, --unread', 'Show only unread messages (handled by mycmail if supported)')
    .option('-n, --limit <count>', 'Limit number of messages (handled by mycmail if supported)', '20')
    .option('--sent', 'Show sent messages instead of inbox (check mycmail docs for support)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const rawAgentId = options.agent || process.env.SPIDERSAN_AGENT || 'cli-agent';

        // Security: Validate agent ID
        let agentId: string;
        try {
            agentId = validateAgentId(rawAgentId);
        } catch (error: any) {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        }

        try {
            // Check if mycmail is available
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail (mycmail) not found.');
            console.error('   Please install it: npm install -g myceliumail');
            process.exit(1);
        }

        // Security: Use spawnSync with argument array instead of string interpolation
        try {
            const result = spawnSync('mycmail', ['inbox'], {
                encoding: 'utf-8',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: agentId }
            });

            if (result.error) {
                throw result.error;
            }

            const output = result.stdout || '';

            if (options.json) {
                // Return structured data if possible
                console.log(JSON.stringify({
                    agent: agentId,
                    command: 'inbox',
                    output: output.trim()
                }, null, 2));
            } else {
                console.log(output);
            }
        } catch (error: any) {
            console.error('❌ Failed to fetch inbox via Myceliumail');
            console.error(error.message || error);
            process.exit(1);
        }
    });
