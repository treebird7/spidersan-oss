import { Command } from 'commander';
import { execSync } from 'child_process';
import { getMessageStorage, parseTierOption } from '../storage/message-factory.js';
import type { MessageType } from '../storage/message-adapter.js';

// Security: Input validation
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

function validateAgentId(agentId: string): string {
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..." (must be alphanumeric with - or _)`);
    }
    return agentId;
}

function getMessageFromStdin(): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', chunk => chunks.push(chunk));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8').trim()));
        process.stdin.on('error', reject);
    });
}

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return '';
    }
}

export const sendCommand = new Command('send')
    .description('Send a message to another agent (tiered fallback)')
    .argument('<to>', 'Recipient agent identifier')
    .argument('<subject>', 'Message subject')
    .option('-m, --message <text>', 'Message body (or reads from stdin)')
    .option('-t, --type <type>', 'Message type: info, question, alert, handoff, file_share', 'info')
    .option('-f, --from <agent>', 'Sender identifier (default: current agent)')
    .option('-b, --branch <name>', 'Related branch name')
    .option('--files <files>', 'Comma-separated list of related files')
    .option('--reply-to <id>', 'Message ID this is replying to')
    .option('--encrypt', 'Encrypt the message (Tier 1 only)')
    .option('--tier <n>', 'Force specific tier (1, 2, or 3)')
    .option('-v, --verbose', 'Show which tier is being used')
    .option('--json', 'Output as JSON')
    .action(async (to, subject, options) => {
        // 1. Validate recipient
        try {
            validateAgentId(to);
        } catch (error: any) {
            console.error(`❌ ${error.message}`);
            process.exit(1);
        }

        // 2. Get message body
        let messageBody = options.message;
        if (!messageBody) {
            if (process.stdin.isTTY) {
                console.error('❌ Message body is required (use -m or pipe stdin)');
                process.exit(1);
            }
            messageBody = await getMessageFromStdin();
        }

        if (!messageBody) {
            console.error('❌ Message body empty');
            process.exit(1);
        }

        // 3. Prepare context
        const branch = options.branch || getCurrentBranch();
        const type: MessageType = options.type || 'info';
        const files = options.files ? options.files.split(',') : [];
        const sender = options.from || process.env.SPIDERSAN_AGENT || 'cli-agent';

        // 4. Get message storage adapter
        const forceTier = parseTierOption(options.tier);

        try {
            const storage = await getMessageStorage({
                forceTier,
                agentId: sender,
                verbose: options.verbose,
            });

            // Warn if encryption requested but not on Tier 1
            if (options.encrypt && storage.getTier() !== 1) {
                console.error('⚠️  Encryption only supported on Tier 1 (mycmail). Message will be sent unencrypted.');
            }

            // 5. Send message
            const message = await storage.send({
                from: sender,
                to,
                subject,
                body: messageBody,
                type,
                encrypted: options.encrypt && storage.getTier() === 1,
                branch: branch || undefined,
                files: files.length > 0 ? files : undefined,
            });

            if (options.json) {
                console.log(JSON.stringify({
                    status: 'sent',
                    tier: storage.getTier(),
                    tierName: storage.getTierName(),
                    message: {
                        id: message.id,
                        to: message.to,
                        subject: message.subject,
                        encrypted: message.encrypted,
                        timestamp: message.timestamp.toISOString(),
                    },
                }, null, 2));
            } else {
                const tierInfo = options.verbose ? ` via ${storage.getTierName()}` : '';
                console.log(`✅ Message sent to ${to}${tierInfo}`);
                if (options.verbose) {
                    console.log(`   ID: ${message.id}`);
                    console.log(`   Subject: ${subject}`);
                }
            }
        } catch (error: any) {
            console.error('❌ Failed to send message');
            console.error(error.message || error);
            process.exit(1);
        }
    });
