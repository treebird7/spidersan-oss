import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';

// Security: Input validation
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;
const VALID_BASE64_KEY = /^[A-Za-z0-9+/=]{20,500}$/;

function validateAgentId(agentId: string): string {
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..."`);
    }
    return agentId;
}

function validatePublicKey(key: string): string {
    if (!VALID_BASE64_KEY.test(key)) {
        throw new Error(`Invalid public key format (expected base64)`);
    }
    return key;
}

export const keyImportCommand = new Command('key-import')
    .description('Import another agent\'s public key (via Myceliumail)')
    .argument('<agentId>', 'Agent ID to associate with the key')
    .argument('<publicKey>', 'Base64-encoded public key')
    .action(async (agentId: string, publicKey: string) => {
        // Security: Validate inputs
        let safeAgentId: string;
        let safeKey: string;
        let myAgent: string;

        try {
            safeAgentId = validateAgentId(agentId);
            safeKey = validatePublicKey(publicKey);
            myAgent = validateAgentId(process.env.SPIDERSAN_AGENT || 'cli-agent');
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
            spawnSync('mycmail', ['key-import', safeAgentId, safeKey], {
                stdio: 'inherit',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: myAgent }
            });
        } catch (error: any) {
            process.exit(1);
        }
    });
