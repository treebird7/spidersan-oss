import { Command } from 'commander';
import { execSync } from 'child_process';

export const msgReadCommand = new Command('read')
    .description('Read a specific message (via Myceliumail)')
    .argument('<id>', 'Message ID (full or partial)')
    .option('--no-mark-read', 'Don\'t mark the message as read (handled by mycmail)')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
        const agentId = process.env.SPIDERSAN_AGENT || 'cli-agent';

        try {
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail (mycmail) not found.');
            console.error('   Please install it: npm install -g myceliumail');
            process.exit(1);
        }

        const cmdParts = [
            `MYCELIUMAIL_AGENT_ID=${agentId}`,
            'mycmail',
            'read',
            id
        ];

        try {
            // Note: mycmail read implicitly marks as read usually.
            // Spidersan's --no-mark-read might not map directly unless mycmail supports it.

            const output = execSync(cmdParts.join(' '), { encoding: 'utf-8' });

            if (options.json) {
                console.log(JSON.stringify({
                    id,
                    output: output.trim()
                }, null, 2));
            } else {
                console.log(output);
            }
        } catch (error: any) {
            console.error('❌ Failed to read message via Myceliumail');
            console.error(error.message || error);
            process.exit(1);
        }
    });
