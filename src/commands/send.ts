import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { SupabaseStorage, type MessageType } from '../storage/supabase.js';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return '';
    }
}

function getRepoName(): string {
    try {
        const remote = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
        // Extract repo name from git URL
        const match = remote.match(/[/:]([^/]+\/[^/]+?)(?:\.git)?$/);
        return match ? match[1] : '';
    } catch {
        return '';
    }
}

export const sendCommand = new Command('send')
    .description('Send a message to another agent')
    .argument('<to>', 'Recipient agent identifier')
    .argument('<subject>', 'Message subject')
    .option('-m, --message <text>', 'Message body (or reads from stdin)')
    .option('-t, --type <type>', 'Message type: info, question, alert, handoff, file_share', 'info')
    .option('-f, --from <agent>', 'Sender identifier (default: current agent)')
    .option('-b, --branch <name>', 'Related branch name')
    .option('--files <files>', 'Comma-separated list of related files')
    .option('--reply-to <id>', 'Message ID this is replying to')
    .option('--json', 'Output as JSON')
    .action(async (to, subject, options) => {
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

        // Validate message type
        const validTypes: MessageType[] = ['info', 'question', 'alert', 'handoff', 'file_share'];
        if (!validTypes.includes(options.type as MessageType)) {
            console.error(`❌ Invalid message type: ${options.type}`);
            console.error(`   Valid types: ${validTypes.join(', ')}`);
            process.exit(1);
        }

        // Get message body
        let messageBody = options.message;
        if (!messageBody) {
            // Read from stdin if no message provided
            console.error('💬 Enter message (Ctrl+D when done):');
            const chunks: Buffer[] = [];
            for await (const chunk of process.stdin) {
                chunks.push(chunk);
            }
            messageBody = Buffer.concat(chunks).toString('utf-8').trim();
        }

        if (!messageBody) {
            console.error('❌ Message body is required.');
            process.exit(1);
        }

        const fromAgent = options.from || process.env.SPIDERSAN_AGENT || 'cli-agent';
        const branchName = options.branch || getCurrentBranch();
        const repoName = getRepoName();

        try {
            const message = await storage.sendMessage({
                fromAgent,
                toAgent: to,
                subject,
                message: messageBody,
                messageType: options.type as MessageType,
                fromRepo: repoName || undefined,
                branchName: branchName || undefined,
                relatedFiles: options.files ? options.files.split(',').map((f: string) => f.trim()) : undefined,
                replyTo: options.replyTo,
            });

            if (options.json) {
                console.log(JSON.stringify(message, null, 2));
                return;
            }

            console.log(`📤 Message sent!`);
            console.log(`   ID: ${message.id}`);
            console.log(`   To: ${to}`);
            console.log(`   Subject: ${subject}`);
            console.log(`   Type: ${options.type}`);
        } catch (error) {
            console.error(`❌ Failed to send message: ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        }
    });
