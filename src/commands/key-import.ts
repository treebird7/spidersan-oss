import { Command } from 'commander';
import { execSync } from 'child_process';

export const keyImportCommand = new Command('key-import')
    .description('Import another agent\'s public key (via Myceliumail)')
    .argument('<agentId>', 'Agent ID to associate with the key')
    .argument('<publicKey>', 'Base64-encoded public key')
    .action(async (agentId: string, publicKey: string) => {
        try {
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail not found');
            process.exit(1);
        }

        const myAgent = process.env.SPIDERSAN_AGENT || 'cli-agent';
        const cmd = `MYCELIUMAIL_AGENT_ID=${myAgent} mycmail key-import ${agentId} "${publicKey}"`;

        try {
            execSync(cmd, { stdio: 'inherit' });
        } catch (error: any) {
            process.exit(1);
        }
    });
