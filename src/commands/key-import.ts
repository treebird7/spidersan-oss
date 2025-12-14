/**
 * spidersan key-import
 * 
 * Import another agent's public key.
 */

import { Command } from 'commander';
import { saveKnownKey, loadKnownKeys } from '../lib/crypto.js';

export const keyImportCommand = new Command('key-import')
    .description('Import another agent\'s public key')
    .argument('<agentId>', 'Agent ID to associate with the key')
    .argument('<publicKey>', 'Base64-encoded public key')
    .action(async (agentId: string, publicKey: string) => {
        // Basic validation
        if (publicKey.length < 40 || publicKey.length > 50) {
            console.error('❌ Invalid public key format. Expected base64 string.');
            process.exit(1);
        }

        saveKnownKey(agentId, publicKey);
        console.log(`🔑 Imported public key for "${agentId}"`);
        console.log('   You can now send encrypted messages to this agent.');

        const allKeys = loadKnownKeys();
        console.log(`\n📋 Known agents: ${Object.keys(allKeys).length}`);
    });
