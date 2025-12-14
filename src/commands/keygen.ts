/**
 * spidersan keygen
 * 
 * Generate a new keypair for encrypted messaging.
 */

import { Command } from 'commander';
import {
    generateKeyPair,
    saveKeyPair,
    hasKeyPair,
    getPublicKeyBase64,
    saveKnownKey,
} from '../lib/crypto.js';

export const keygenCommand = new Command('keygen')
    .description('Generate a new keypair for encrypted messaging')
    .option('--agent <id>', 'Agent ID (default: from SPIDERSAN_AGENT env)')
    .option('--force', 'Overwrite existing keypair')
    .action(async (options) => {
        const agentId = options.agent || process.env.SPIDERSAN_AGENT;

        if (!agentId) {
            console.error('❌ Agent ID required. Set SPIDERSAN_AGENT env or use --agent');
            process.exit(1);
        }

        if (hasKeyPair(agentId) && !options.force) {
            console.log(`🔑 Keypair already exists for "${agentId}"`);
            console.log('   Use --force to regenerate (WARNING: old keys will be lost!)');

            const publicKey = getPublicKeyBase64(agentId);
            console.log(`\n📤 Public key:\n   ${publicKey}`);
            return;
        }

        const keyPair = generateKeyPair();
        saveKeyPair(agentId, keyPair);

        // Also save our own public key in known keys
        const publicKeyBase64 = getPublicKeyBase64(agentId)!;
        saveKnownKey(agentId, publicKeyBase64);

        console.log(`🔑 Generated new keypair for "${agentId}"`);
        console.log(`   Saved to: ~/.spidersan/keys/${agentId}.key.json`);
        console.log(`\n📤 Your public key (share this with other agents):\n   ${publicKeyBase64}`);
        console.log('\n💡 Other agents can import your key with:');
        console.log(`   spidersan key-import ${agentId} ${publicKeyBase64}`);
    });
