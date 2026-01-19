import { Command } from 'commander';
import { execSync } from 'child_process';

export const keygenCommand = new Command('keygen')
    .description('Generate a new keypair for encrypted messaging (via Myceliumail)')
    .option('--agent <id>', 'Agent ID (default: from SPIDERSAN_AGENT env)')
    .option('--force', 'Overwrite existing keypair (if supported by mycmail)')
    .action(async (options) => {
        const agentId = options.agent || process.env.SPIDERSAN_AGENT;

        if (!agentId) {
            console.error('❌ Agent ID required. Set SPIDERSAN_AGENT env or use --agent');
            process.exit(1);
        }

        try {
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail (mycmail) not found.');
            process.exit(1);
        }

        console.log(`🔑 Delegating to Myceliumail for agent: ${agentId}`);
        const cmd = `MYCELIUMAIL_AGENT_ID=${agentId} mycmail keygen ${options.force ? '--force' : ''}`; // Adjust flags if mycmail differs

        try {
            execSync(cmd, { stdio: 'inherit' });
        } catch (error: any) {
            // mycmail usually handles error display
            process.exit(1);
        }
    });
