import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';

// Security: Input validation
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

function validateAgentId(agentId: string): string {
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..."`);
    }
    return agentId;
}

export const keygenCommand = new Command('keygen')
    .description('Generate a new keypair for encrypted messaging (via Myceliumail)')
    .option('--agent <id>', 'Agent ID (default: from SPIDERSAN_AGENT env)')
    .option('--force', 'Overwrite existing keypair (if supported by mycmail)')
    .action(async (options) => {
        const rawAgentId = options.agent || process.env.SPIDERSAN_AGENT;

        if (!rawAgentId) {
            console.error('❌ Agent ID required. Set SPIDERSAN_AGENT env or use --agent');
            process.exit(1);
        }

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
            console.error('❌ Myceliumail (mycmail) not found.');
            process.exit(1);
        }

        console.log(`🔑 Delegating to Myceliumail for agent: ${agentId}`);

        // Security: Use spawnSync with argument array
        const args = ['keygen'];
        if (options.force) {
            args.push('--force');
        }

        try {
            spawnSync('mycmail', args, {
                stdio: 'inherit',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: agentId }
            });
        } catch (error: any) {
            process.exit(1);
        }
    });
