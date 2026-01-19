import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';

// Security: Input validation
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;
const VALID_MESSAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,64}$/;

function validateAgentId(agentId: string): string {
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..."`);
    }
    return agentId;
}

function validateMessageId(id: string): string {
    if (!VALID_MESSAGE_ID.test(id)) {
        throw new Error(`Invalid message ID: "${id.slice(0, 20)}..."`);
    }
    return id;
}

export const msgReadCommand = new Command('read')
    .description('Read a specific message (via Myceliumail)')
    .argument('<id>', 'Message ID (full or partial)')
    .option('--no-mark-read', 'Don\'t mark the message as read (handled by mycmail)')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
        const rawAgentId = process.env.SPIDERSAN_AGENT || 'cli-agent';

        // Security: Validate inputs
        let agentId: string;
        let messageId: string;
        try {
            agentId = validateAgentId(rawAgentId);
            messageId = validateMessageId(id);
        } catch (error: any) {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        }

        try {
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail (mycmail) not found.');
            console.error('   Please install it: npm install -g myceliumail');
            process.exit(1);
        }

        // Security: Use spawnSync with argument array instead of string interpolation
        try {
            const result = spawnSync('mycmail', ['read', messageId], {
                encoding: 'utf-8',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: agentId }
            });

            if (result.error) {
                throw result.error;
            }

            const output = result.stdout || '';

            if (options.json) {
                console.log(JSON.stringify({
                    id: messageId,
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
