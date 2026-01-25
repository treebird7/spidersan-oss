import { Command } from 'commander';
import { getMessageStorage, parseTierOption } from '../storage/message-factory.js';

// Security: Input validation
const VALID_MESSAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,64}$/;

function validateMessageId(id: string): string {
    if (!VALID_MESSAGE_ID.test(id)) {
        throw new Error(`Invalid message ID: "${id.slice(0, 20)}..."`);
    }
    return id;
}

function formatTimestamp(date: Date): string {
    return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export const msgReadCommand = new Command('read')
    .description('Read a specific message (tiered fallback)')
    .argument('<id>', 'Message ID (full or partial)')
    .option('--no-mark-read', 'Don\'t mark the message as read')
    .option('--tier <n>', 'Force specific tier (1, 2, or 3)')
    .option('-v, --verbose', 'Show which tier is being used')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
        const agentId = process.env.SPIDERSAN_AGENT || 'cli-agent';

        // Security: Validate message ID
        let messageId: string;
        try {
            messageId = validateMessageId(id);
        } catch (error: any) {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        }

        // Get message storage adapter
        const forceTier = parseTierOption(options.tier);

        try {
            const storage = await getMessageStorage({
                forceTier,
                agentId,
                verbose: options.verbose,
            });

            // Read message
            const message = await storage.read(messageId);

            if (!message) {
                console.error(`❌ Message not found: ${messageId}`);
                process.exit(1);
            }

            // Mark as read if requested
            if (options.markRead !== false) {
                await storage.markRead(messageId);
            }

            if (options.json) {
                console.log(JSON.stringify({
                    tier: storage.getTier(),
                    tierName: storage.getTierName(),
                    message: {
                        ...message,
                        timestamp: message.timestamp.toISOString(),
                    },
                }, null, 2));
                return;
            }

            // Display message
            const tierInfo = options.verbose ? ` (via ${storage.getTierName()})` : '';
            const encryptIcon = message.encrypted ? ' 🔒' : '';
            const typeLabel = message.type !== 'info' ? ` [${message.type.toUpperCase()}]` : '';

            console.log(`\n📧 Message${tierInfo}\n`);
            console.log('─'.repeat(60));
            console.log(`Subject: ${message.subject}${typeLabel}${encryptIcon}`);
            console.log(`From:    ${message.from}`);
            console.log(`To:      ${message.to}`);
            console.log(`Date:    ${formatTimestamp(message.timestamp)}`);
            console.log(`ID:      ${message.id}`);

            if (message.branch) {
                console.log(`Branch:  ${message.branch}`);
            }

            if (message.files && message.files.length > 0) {
                console.log(`Files:   ${message.files.join(', ')}`);
            }

            console.log('─'.repeat(60));
            console.log('');
            console.log(message.body);
            console.log('');
        } catch (error: any) {
            console.error('❌ Failed to read message');
            console.error(error.message || error);
            process.exit(1);
        }
    });
