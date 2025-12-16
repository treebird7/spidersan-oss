import { Command } from 'commander';
import { execSync } from 'child_process';

export const keysCommand = new Command('keys')
    .description('List known public keys (via Myceliumail)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const agentId = process.env.SPIDERSAN_AGENT || 'cli-agent';

        try {
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail not found');
            process.exit(1);
        }

        const cmd = `MYCELIUMAIL_AGENT_ID=${agentId} mycmail keys`;

        try {
            const output = execSync(cmd, { encoding: 'utf-8' });
            if (options.json) {
                // Return synthetic JSON structure if mycmail doesn't output JSON natively yet
                console.log(JSON.stringify({
                    command: 'keys',
                    output: output.trim()
                }, null, 2));
            } else {
                console.log(output);
            }
        } catch (error: any) {
            process.exit(1);
        }
    });
