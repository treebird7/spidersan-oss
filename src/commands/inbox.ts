import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { SupabaseStorage, type AgentMessage } from '../storage/supabase.js';

function getTimeAgo(date: Date): string {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
}

function getTypeEmoji(type: string): string {
    switch (type) {
        case 'info': return 'ℹ️';
        case 'question': return '❓';
        case 'alert': return '🚨';
        case 'handoff': return '🤝';
        case 'file_share': return '📎';
        default: return '📧';
    }
}

function truncate(str: string, maxLen: number): string {
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen - 3) + '...';
}

export const inboxCommand = new Command('inbox')
    .description('View messages sent to you')
    .option('-a, --agent <id>', 'Agent identifier (default: SPIDERSAN_AGENT env or "cli-agent")')
    .option('-u, --unread', 'Show only unread messages')
    .option('-n, --limit <count>', 'Limit number of messages', '20')
    .option('--sent', 'Show sent messages instead of inbox')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const storage = await getStorage();

        // Messaging requires Supabase storage
        if (!(storage instanceof SupabaseStorage)) {
            console.error('❌ Messaging requires Supabase storage.');
            console.error('   Configure SUPABASE_URL and SUPABASE_KEY env vars.');
            process.exit(1);
        }

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const agentId = options.agent || process.env.SPIDERSAN_AGENT || 'cli-agent';
        const limit = parseInt(options.limit, 10) || 20;

        try {
            let messages: AgentMessage[];

            if (options.sent) {
                messages = await storage.getSentMessages(agentId, { limit });
            } else {
                messages = await storage.getInbox(agentId, {
                    unreadOnly: options.unread,
                    limit,
                });
            }

            if (options.json) {
                console.log(JSON.stringify(messages, null, 2));
                return;
            }

            if (messages.length === 0) {
                if (options.sent) {
                    console.log('📤 No sent messages yet.');
                } else if (options.unread) {
                    console.log('📬 No unread messages. You\'re all caught up!');
                } else {
                    console.log('📭 Inbox is empty.');
                }
                return;
            }

            // Get unread count
            const unreadCount = options.sent ? 0 : await storage.getUnreadCount(agentId);

            if (options.sent) {
                console.log(`📤 Sent Messages (${messages.length}):\n`);
            } else {
                console.log(`📬 Inbox for ${agentId}${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}:\n`);
            }

            for (const msg of messages) {
                const emoji = getTypeEmoji(msg.messageType);
                const readStatus = msg.read ? '  ' : '● ';
                const ago = getTimeAgo(msg.createdAt);
                const direction = options.sent ? `→ ${msg.toAgent}` : `← ${msg.fromAgent}`;
                const encryptedFlag = msg.encrypted ? ' 🔒' : '';

                console.log(`  ${readStatus}${emoji} ${truncate(msg.subject, 40)}${encryptedFlag}`);
                console.log(`     └─ ${direction} | ${ago}`);
                console.log(`     └─ ID: ${msg.id.slice(0, 8)}...`);

                if (msg.branchName) {
                    console.log(`     └─ Branch: ${msg.branchName}`);
                }
                console.log('');
            }

            console.log(`Use 'spidersan read <id>' to view a message.`);
        } catch (error) {
            console.error(`❌ Failed to fetch messages: ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        }
    });
