/**
 * spidersan lock
 * 
 * Claim or release locks on symbols (functions, classes, etc.)
 * Uses CRDT for decentralized coordination, syncs via Hub.
 * 
 * Part of Codex 5.2 implementation.
 */

import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { ASTParser } from '../lib/ast.js';
import { createSwarmState, SwarmState } from '../lib/crdt.js';

const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';
const AGENT_ID = process.env.SPIDERSAN_AGENT || process.env.MYCELIUMAIL_AGENT_ID || 'unknown';

// Singleton swarm state (persists across commands in same session)
let swarmState: SwarmState | null = null;

function getSwarmState(): SwarmState {
    if (!swarmState) {
        swarmState = createSwarmState(AGENT_ID, async (update) => {
            // Sync updates to Hub
            try {
                await syncToHub(update);
            } catch {
                // Hub offline - silent fail
            }
        });
    }
    return swarmState;
}

/**
 * Sync CRDT update to Hub for other agents
 */
async function syncToHub(update: Uint8Array): Promise<void> {
    const base64Update = Buffer.from(update).toString('base64');

    await fetch(`${HUB_URL}/api/spidersan/crdt-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            agent: AGENT_ID,
            update: base64Update,
            timestamp: Date.now(),
        }),
    });
}

/**
 * Pull latest state from Hub
 */
async function pullFromHub(): Promise<void> {
    try {
        const response = await fetch(`${HUB_URL}/api/spidersan/crdt-state`);
        if (response.ok) {
            const data = await response.json() as { updates: string[] };
            const state = getSwarmState();
            for (const base64Update of data.updates || []) {
                const update = Buffer.from(base64Update, 'base64');
                state.applyUpdate(new Uint8Array(update));
            }
        }
    } catch {
        // Hub offline - continue with local state
    }
}

/**
 * Extract symbol ID from file:symbol format
 */
function parseSymbolId(symbolId: string): { file: string; symbol: string } | null {
    const parts = symbolId.split(':');
    if (parts.length === 2) {
        return { file: parts[0], symbol: parts[1] };
    }
    return null;
}

/**
 * Generate symbol ID from file path and symbol name
 */
function makeSymbolId(file: string, symbol: string): string {
    return `${file}:${symbol}`;
}

export const lockCommand = new Command('lock')
    .description('Claim or release locks on symbols for coordination')
    .argument('[symbolId]', 'Symbol to lock (format: file.ts:functionName)')
    .option('--release', 'Release a lock instead of acquiring')
    .option('--release-all', 'Release all locks held by this agent')
    .option('--list', 'List all active locks')
    .option('--file <path>', 'Lock all symbols in a file')
    .option('--intent <description>', 'Describe what you intend to do with the symbol')
    .option('--sync', 'Force sync with Hub before operation')
    .action(async (symbolId, options) => {
        const state = getSwarmState();

        // Sync with Hub first if requested
        if (options.sync) {
            console.log('🔄 Syncing with Hub...');
            await pullFromHub();
        }

        // List all locks
        if (options.list) {
            const locks = state.getAllLocks();

            if (locks.length === 0) {
                console.log('🕷️ No active locks');
                return;
            }

            console.log(`\n🕷️ ACTIVE LOCKS (${locks.length}):`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            // Group by agent
            const byAgent = new Map<string, typeof locks>();
            for (const lock of locks) {
                const existing = byAgent.get(lock.agentId) || [];
                existing.push(lock);
                byAgent.set(lock.agentId, existing);
            }

            for (const [agentId, agentLocks] of byAgent) {
                const isMe = agentId === AGENT_ID;
                console.log(`${isMe ? '👤' : '👥'} ${agentId}${isMe ? ' (you)' : ''}:`);
                for (const lock of agentLocks) {
                    const age = Math.floor((Date.now() - lock.timestamp) / 1000 / 60);
                    console.log(`   🔒 ${lock.symbolId} (${age}m ago)`);
                    if (lock.description) {
                        console.log(`      └─ ${lock.description}`);
                    }
                }
                console.log('');
            }
            return;
        }

        // Release all locks
        if (options.releaseAll) {
            const released = state.releaseAllLocks();
            console.log(`🔓 Released ${released} lock(s)`);
            return;
        }

        // Lock all symbols in a file
        if (options.file) {
            const filePath = options.file;

            if (!existsSync(filePath)) {
                console.error(`❌ File not found: ${filePath}`);
                process.exit(1);
            }

            const code = readFileSync(filePath, 'utf-8');
            const parser = new ASTParser();
            const fileSymbols = parser.parseCode(code, filePath);

            console.log(`\n🕷️ LOCKING SYMBOLS IN ${filePath}:`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

            let acquired = 0;
            let blocked = 0;

            for (const symbol of fileSymbols.symbols) {
                const id = makeSymbolId(filePath, symbol.name);
                const success = state.acquireLock(id, symbol.hash, options.intent);

                if (success) {
                    console.log(`  🔒 ${symbol.type} '${symbol.name}' — locked`);
                    acquired++;
                } else {
                    const existingLock = state.getLock(id);
                    console.log(`  ❌ ${symbol.type} '${symbol.name}' — locked by ${existingLock?.agentId}`);
                    blocked++;
                }
            }

            console.log(`\n✅ Acquired: ${acquired} | ❌ Blocked: ${blocked}`);

            if (options.intent) {
                state.setIntent(options.intent);
                console.log(`\n📝 Intent set: "${options.intent}"`);
            }
            return;
        }

        // Single symbol lock/release
        if (!symbolId) {
            console.error('❌ Symbol ID required (format: file.ts:functionName)');
            console.error('   Or use: --file <path> to lock all symbols in a file');
            console.error('   Or use: --list to see active locks');
            process.exit(1);
        }

        if (options.release) {
            const success = state.releaseLock(symbolId);
            if (success) {
                console.log(`🔓 Released lock on '${symbolId}'`);
            } else {
                console.log(`⚠️ Could not release '${symbolId}' (not locked by you)`);
            }
            return;
        }

        // Acquire lock
        const parsed = parseSymbolId(symbolId);
        let hash = 'manual';

        // If it's a file:symbol format, try to compute actual hash
        if (parsed && existsSync(parsed.file)) {
            try {
                const code = readFileSync(parsed.file, 'utf-8');
                const parser = new ASTParser();
                const fileSymbols = parser.parseCode(code, parsed.file);
                const symbol = fileSymbols.symbols.find(s => s.name === parsed.symbol);
                if (symbol) {
                    hash = symbol.hash;
                }
            } catch {
                // Use manual hash
            }
        }

        const success = state.acquireLock(symbolId, hash, options.intent);

        if (success) {
            console.log(`🔒 Acquired lock on '${symbolId}'`);
            if (options.intent) {
                state.setIntent(options.intent);
                console.log(`📝 Intent: "${options.intent}"`);
            }
        } else {
            const existingLock = state.getLock(symbolId);
            console.log(`❌ Could not lock '${symbolId}'`);
            console.log(`   Already locked by: ${existingLock?.agentId}`);
            if (existingLock?.description) {
                console.log(`   Their intent: "${existingLock.description}"`);
            }
            process.exit(1);
        }
    });
