import { Command } from 'commander';
import { getStorage } from '../storage/index.js';
import { SupabaseStorage } from '../storage/supabase.js';

function formatDate(date: Date): string {
    return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getTypeLabel(type: string): string {
    switch (type) {
        case 'info': return 'ℹ️  Info';
        case 'question': return '❓ Question';
        case 'alert': return '🚨 Alert';
        case 'handoff': return '🤝 Handoff';
        case 'file_share': return '📎 File Share';
        default: return '📧 Message';
    }
}

export const msgReadCommand = new Command('read')
    .description('Read a specific message')
    .argument('<id>', 'Message ID (full or partial)')
    .option('--no-mark-read', 'Don\'t mark the message as read')
    .option('--json', 'Output as JSON')
    .action(async (id, options) => {
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

        try {
            const message = await storage.getMessage(id);

            if (!message) {
                console.error(`❌ Message not found: ${id}`);
                console.error('   Use the full message ID from inbox.');
                process.exit(1);
            }

            // Mark as read (unless --no-mark-read)
            if (options.markRead && !message.read) {
                await storage.markMessageRead(message.id);
            }

            if (options.json) {
                console.log(JSON.stringify(message, null, 2));
                return;
            }

            // Pretty print the message
            console.log('═'.repeat(60));
            console.log(`${getTypeLabel(message.messageType)}`);
            console.log('═'.repeat(60));
            console.log('');
            console.log(`  From:    ${message.fromAgent}${message.fromRepo ? ` (${message.fromRepo})` : ''}`);
            console.log(`  To:      ${message.toAgent}${message.toRepo ? ` (${message.toRepo})` : ''}`);
            console.log(`  Date:    ${formatDate(message.createdAt)}`);
            console.log(`  Subject: ${message.subject}`);

            if (message.branchName) {
                console.log(`  Branch:  ${message.branchName}`);
            }

            if (message.relatedFiles && message.relatedFiles.length > 0) {
                console.log(`  Files:   ${message.relatedFiles.join(', ')}`);
            }

            if (message.repliedTo) {
                console.log(`  Reply to: ${message.repliedTo.slice(0, 8)}...`);
            }

            console.log('');
            console.log('─'.repeat(60));
            console.log('');
            console.log(message.message);
            console.log('');
            console.log('─'.repeat(60));
            console.log(`  ID: ${message.id}`);

            if (message.attachedFiles) {
                console.log('');
                console.log('📎 Attachments:');
                console.log(JSON.stringify(message.attachedFiles, null, 2));
            }

            console.log('');
            console.log(`Reply: spidersan send ${message.fromAgent} "Re: ${message.subject}" --reply-to ${message.id}`);

        } catch (error) {
            console.error(`❌ Failed to read message: ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        }
    });
