import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { SupabaseStorage, type MessageType } from '../storage/supabase.js';
import {
    loadKeyPair,
    getKnownKey,
    encryptMessage,
    hasKeyPair,
} from '../lib/crypto.js';

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
    .option('--encrypt', 'Encrypt the message (requires keys setup)')
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

        // Handle encryption if requested
        let finalMessage = messageBody;
        let finalSubject = subject;
        let isEncrypted = false;

        if (options.encrypt) {
            // Check if we have our own keypair
            if (!hasKeyPair(fromAgent)) {
                console.error(`❌ No keypair found for "${fromAgent}"`);
                console.error('   Run: spidersan keygen');
                process.exit(1);
            }

            // Check if we have recipient's public key
            const recipientPublicKey = getKnownKey(to);
            if (!recipientPublicKey) {
                console.error(`❌ No public key found for recipient "${to}"`);
                console.error('   Import their key: spidersan key-import <agent> <key>');
                process.exit(1);
            }

            // Load our keypair
            const senderKeyPair = loadKeyPair(fromAgent)!;

            // Encrypt message and subject
            const encryptedContent = encryptMessage(
                JSON.stringify({ message: messageBody, subject }),
                recipientPublicKey,
                senderKeyPair
            );

            // Store encrypted data as JSON in message field
            finalMessage = JSON.stringify(encryptedContent);
            finalSubject = '🔒 [Encrypted Message]';
            isEncrypted = true;
        }

        try {
            const message = await storage.sendMessage({
                fromAgent,
                toAgent: to,
                subject: finalSubject,
                message: finalMessage,
                messageType: options.type as MessageType,
                fromRepo: repoName || undefined,
                branchName: branchName || undefined,
                relatedFiles: options.files ? options.files.split(',').map((f: string) => f.trim()) : undefined,
                replyTo: options.replyTo,
                encrypted: isEncrypted,
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
            if (isEncrypted) {
                console.log(`   🔒 Encrypted: Yes`);
            }
        } catch (error) {
            console.error(`❌ Failed to send message: ${error instanceof Error ? error.message : error}`);
            process.exit(1);
        }
    });
