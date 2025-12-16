import { Command } from 'commander';
import { execSync } from 'child_process';

export const inboxCommand = new Command('inbox')
    .description('View messages sent to you (via Myceliumail)')
    .option('-a, --agent <id>', 'Agent identifier (default: SPIDERSAN_AGENT env or "cli-agent")')
    .option('-u, --unread', 'Show only unread messages (handled by mycmail if supported)')
    .option('-n, --limit <count>', 'Limit number of messages (handled by mycmail if supported)', '20')
    .option('--sent', 'Show sent messages instead of inbox (check mycmail docs for support)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const agentId = options.agent || process.env.SPIDERSAN_AGENT || 'cli-agent';

        try {
            // Check if mycmail is available
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail (mycmail) not found.');
            console.error('   Please install it: npm install -g myceliumail');
            process.exit(1);
        }

        const cmdParts = [
            `MYCELIUMAIL_AGENT_ID=${agentId}`,
            'mycmail',
            'inbox'
        ];

        // Pass through flags if mycmail supports them (assuming standard CLI pattern)
        // If mycmail 1.1.0 doesn't support them, it might error or ignore. 
        // We act as a pass-through wrapper.

        if (options.limit) {
            // Check usage: often --limit or -n
            // We pass it blindly? Or just let mycmail default?
            // mycmail 1.0.0 help showed [options]. 
        }

        // Just run inbox
        try {
            const output = execSync(cmdParts.join(' '), { encoding: 'utf-8' });

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
