import { Command } from 'commander';
import {
    getMessageStorage,
    parseTierOption,
    printTierStatus,
} from '../storage/message-factory.js';

// Security: Input validation
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

function validateAgentId(agentId: string): string {
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..." (must be alphanumeric with - or _)`);
    }
    return agentId;
}

function formatTimestamp(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ago`;
    } else if (hours > 0) {
        return `${hours}h ago`;
    } else {
        const minutes = Math.floor(diff / (1000 * 60));
        return minutes > 0 ? `${minutes}m ago` : 'just now';
    }
}

export const inboxCommand = new Command('inbox')
    .description('View messages sent to you (tiered fallback)')
    .option('-a, --agent <id>', 'Agent identifier (default: SPIDERSAN_AGENT env or "cli-agent")')
    .option('-u, --unread', 'Show only unread messages')
    .option('-n, --limit <count>', 'Limit number of messages', '20')
    .option('--status', 'Show tier availability status')
    .option('--tier <n>', 'Force specific tier (1, 2, or 3)')
    .option('-v, --verbose', 'Show which tier is being used')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const rawAgentId = options.agent || process.env.SPIDERSAN_AGENT || 'cli-agent';

        // Security: Validate agent ID
        let agentId: string;
        try {
            agentId = validateAgentId(rawAgentId);
        } catch (error: any) {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        }

        // Handle --status flag
        if (options.status) {
            await printTierStatus({ agentId });
            return;
        }

        // Get message storage adapter
        const forceTier = parseTierOption(options.tier);

        try {
            const storage = await getMessageStorage({
                forceTier,
                agentId,
                verbose: options.verbose,
            });

            // Fetch messages
            const messages = await storage.inbox(agentId, {
                unread: options.unread,
                limit: parseInt(options.limit, 10),
            });

            if (options.json) {
                console.log(JSON.stringify({
                    agent: agentId,
                    tier: storage.getTier(),
                    tierName: storage.getTierName(),
                    count: messages.length,
                    messages: messages.map(m => ({
                        ...m,
                        timestamp: m.timestamp.toISOString(),
                    })),
                }, null, 2));
                return;
            }

            // Display messages
            const tierInfo = options.verbose ? ` (via ${storage.getTierName()})` : '';
            console.log(`\n📬 Inbox for ${agentId}${tierInfo}\n`);

            if (messages.length === 0) {
                console.log('  No messages.\n');
                return;
            }

            for (const msg of messages) {
                const readIcon = msg.read ? '📭' : '📩';
                const encryptIcon = msg.encrypted ? '🔒' : '';
                const typeIcon = getTypeIcon(msg.type);
                const timeStr = formatTimestamp(msg.timestamp);

                console.log(`${readIcon} ${typeIcon} ${msg.subject} ${encryptIcon}`);
                console.log(`   From: ${msg.from} · ${timeStr}`);
                console.log(`   ID: ${msg.id}`);

                if (msg.branch) {
                    console.log(`   Branch: ${msg.branch}`);
                }

                console.log('');
            }

            console.log(`Total: ${messages.length} message(s)\n`);
        } catch (error: any) {
            console.error('❌ Failed to fetch inbox');
            console.error(error.message || error);
            process.exit(1);
        }
    });

function getTypeIcon(type: string): string {
    switch (type) {
        case 'question':
            return '❓';
        case 'alert':
            return '🚨';
        case 'handoff':
            return '🤝';
        case 'file_share':
            return '📎';
        default:
            return 'ℹ️';
    }
}
