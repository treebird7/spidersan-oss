/**
 * Message Storage Factory - Tiered Selection Logic
 *
 * Selects the best available message storage backend:
 *   Tier 1: Mycmail/Supabase (real-time, full features)
 *   Tier 2: Git coordination branch (near-real-time on pull)
 *   Tier 3: Local JSON (single-machine only)
 */

import { MycmailAdapter } from './mycmail-adapter.js';
import { GitMessagesAdapter } from './git-messages.js';
import { LocalMessagesAdapter } from './local-messages.js';
import type { MessageStorageAdapter, TierStatus } from './message-adapter.js';

export interface MessageStorageOptions {
    /** Force a specific tier (1, 2, or 3) */
    forceTier?: number;
    /** Agent ID for mycmail */
    agentId?: string;
    /** Base path for git/local storage */
    basePath?: string;
    /** Enable verbose logging */
    verbose?: boolean;
}

/**
 * Get the best available message storage adapter
 */
export async function getMessageStorage(
    options: MessageStorageOptions = {}
): Promise<MessageStorageAdapter> {
    const { forceTier, agentId, basePath, verbose } = options;

    // Create all adapters
    const tier1 = new MycmailAdapter(agentId);
    const tier2 = new GitMessagesAdapter(basePath);
    const tier3 = new LocalMessagesAdapter(basePath);

    // If tier is forced, return that adapter (even if unavailable)
    if (forceTier === 1) {
        if (verbose) console.error('🔗 Forced Tier 1: mycmail-supabase');
        return tier1;
    }
    if (forceTier === 2) {
        if (verbose) console.error('🔗 Forced Tier 2: git-coordination-branch');
        return tier2;
    }
    if (forceTier === 3) {
        if (verbose) console.error('🔗 Forced Tier 3: local-json');
        return tier3;
    }

    // Auto-detect best available tier
    if (await tier1.isAvailable()) {
        if (verbose) console.error('🔗 Using Tier 1: mycmail-supabase');
        return tier1;
    }

    if (await tier2.isAvailable()) {
        if (verbose) console.error('🔗 Using Tier 2: git-coordination-branch');
        return tier2;
    }

    if (verbose) console.error('🔗 Using Tier 3: local-json');
    return tier3;
}

/**
 * Get status of all message storage tiers
 */
export async function getAllTierStatus(
    options: MessageStorageOptions = {}
): Promise<TierStatus[]> {
    const { agentId, basePath } = options;

    const tier1 = new MycmailAdapter(agentId);
    const tier2 = new GitMessagesAdapter(basePath);
    const tier3 = new LocalMessagesAdapter(basePath);

    const [status1, status2, status3] = await Promise.all([
        tier1.getStatus(),
        tier2.getStatus(),
        tier3.getStatus(),
    ]);

    return [status1, status2, status3];
}

/**
 * Print tier status to console
 */
export async function printTierStatus(
    options: MessageStorageOptions = {}
): Promise<void> {
    const statuses = await getAllTierStatus(options);

    console.log('\n📡 Message Tier Status\n');
    console.log('┌─────────────────────────────────────────────────────────────┐');

    for (const status of statuses) {
        const icon = status.available ? '✅' : '❌';
        const tierLabel = `Tier ${status.tier}`;
        const nameLabel = status.name.padEnd(25);
        console.log(`│ ${icon} ${tierLabel}: ${nameLabel} │`);
        console.log(`│    ${(status.reason || '').padEnd(53)} │`);
    }

    console.log('└─────────────────────────────────────────────────────────────┘');

    // Show which tier would be selected
    const adapter = await getMessageStorage(options);
    console.log(`\n🎯 Active: Tier ${adapter.getTier()} (${adapter.getTierName()})\n`);
}

/**
 * Parse tier option from command line
 */
export function parseTierOption(tierArg: string | undefined): number | undefined {
    if (!tierArg) return undefined;

    const tier = parseInt(tierArg, 10);
    if (isNaN(tier) || tier < 1 || tier > 3) {
        console.error(`❌ Invalid tier: ${tierArg}. Must be 1, 2, or 3.`);
        process.exit(1);
    }

    return tier;
}
