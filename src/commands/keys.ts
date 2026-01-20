import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';
import { validateAgentId } from '../lib/security.js';

export const keysCommand = new Command('keys')
    .description('List known public keys (via Myceliumail)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const rawAgentId = process.env.SPIDERSAN_AGENT || 'cli-agent';

        // Security: Validate agent ID
        let agentId: string;
        try {
            agentId = validateAgentId(rawAgentId);
        } catch (error: any) {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        }

        try {
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail not found');
            process.exit(1);
        }

        // Security: Use spawnSync with argument array
        try {
            const result = spawnSync('mycmail', ['keys'], {
                encoding: 'utf-8',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: agentId }
            });

            if (result.error) {
                throw result.error;
            }

            const output = result.stdout || '';
            if (options.json) {
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
