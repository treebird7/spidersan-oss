/**
 * spidersan keys
 * 
 * List known public keys.
 */

import { Command } from 'commander';
import { loadKnownKeys, hasKeyPair, getPublicKeyBase64 } from '../lib/crypto.js';

export const keysCommand = new Command('keys')
    .description('List known public keys')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const agentId = process.env.SPIDERSAN_AGENT || 'unknown';
        const knownKeys = loadKnownKeys();
        const hasOwnKey = hasKeyPair(agentId);

        if (options.json) {
            console.log(JSON.stringify({
                agentId,
                hasOwnKey,
                knownKeys,
            }, null, 2));
            return;
        }

        console.log('🔑 Spider Mail Encryption Keys\n');

        // Own key status
        if (hasOwnKey) {
            const publicKey = getPublicKeyBase64(agentId);
            console.log(`✅ Your key (${agentId}):`);
            console.log(`   ${publicKey}\n`);
        } else {
            console.log(`❌ No keypair for "${agentId}"`);
            console.log('   Run: spidersan keygen\n');
        }

        // Known keys
        const agents = Object.keys(knownKeys);
        if (agents.length === 0) {
            console.log('📋 No known agent keys.');
            console.log('   Import keys: spidersan key-import <agent> <key>');
        } else {
            console.log(`📋 Known Agents (${agents.length}):\n`);
            for (const agent of agents) {
                const isSelf = agent === agentId;
                const prefix = isSelf ? '  🔹' : '  🔸';
                console.log(`${prefix} ${agent}${isSelf ? ' (you)' : ''}`);
                console.log(`     ${knownKeys[agent].substring(0, 20)}...`);
            }
        }
    });
