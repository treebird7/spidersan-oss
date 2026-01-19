import { Command } from 'commander';
import { execSync, spawnSync } from 'child_process';

// Security: Input validation
const VALID_AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,30}$/i;

function validateAgentId(agentId: string): string {
    if (!VALID_AGENT_ID.test(agentId)) {
        throw new Error(`Invalid agent ID: "${agentId.slice(0, 20)}..." (must be alphanumeric with - or _)`);
    }
    return agentId;
}

function sanitizeText(text: string): string {
    // Remove shell metacharacters but allow normal text
    return text.replace(/[`$(){}[\]|;&<>]/g, '');
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
    .description('Send a message to another agent (via Myceliumail)')
    .argument('<to>', 'Recipient agent identifier')
    .argument('<subject>', 'Message subject')
    .option('-m, --message <text>', 'Message body (or reads from stdin)')
    .option('-t, --type <type>', 'Message type: info, question, alert, handoff, file_share', 'info')
    .option('-f, --from <agent>', 'Sender identifier (default: current agent)')
    .option('-b, --branch <name>', 'Related branch name')
    .option('--files <files>', 'Comma-separated list of related files')
    .option('--reply-to <id>', 'Message ID this is replying to (not yet supported in mycmail)')
    .option('--encrypt', 'Encrypt the message')
    .option('--json', 'Output as JSON')
    .action(async (to, subject, options) => {
        // 1. Get message body
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

        // 2. Prepare context
        const branch = options.branch || getCurrentBranch();
        const type = options.type || 'info';
        const files = options.files ? options.files.split(',') : [];

        // 3. Format message with Spidersan context (until mycmail supports metadata)
        let contextHeader = '';
        if (type !== 'info') contextHeader += `Type: ${type}\n`;
        if (branch) contextHeader += `Branch: ${branch}\n`;
        if (files.length > 0) contextHeader += `Files: ${files.join(', ')}\n`;

        const fullMessage = contextHeader ? `${contextHeader}\n${messageBody}` : messageBody;

        // 4. Construct mycmail command
        // Note: We use the sender identity for MYCELIUMAIL_AGENT_ID env var
        const sender = options.from || process.env.SPIDERSAN_AGENT || 'cli-agent';

        try {
            // Check if mycmail is available
            execSync('which mycmail', { stdio: 'ignore' });
        } catch {
            console.error('❌ Myceliumail (mycmail) not found.');
            console.error('   Please install it: npm install -g myceliumail');
            process.exit(1);
        }

        const cmdParts = [
            `MYCELIUMAIL_AGENT_ID=${sender}`,
            'mycmail',
            'send',
            to,
            `"${subject}"`, // Subject needs quotes
            '--message',
            `"${fullMessage.replace(/"/g, '\\"')}"` // Escape quotes in message
        ];

        if (options.encrypt) {
            cmdParts.push('--encrypt');
        }

        // Execute
        // Execute using execFileSync with argument array (prevents shell injection)
        try {
            // Security: Validate and sanitize inputs
            const safeTo = validateAgentId(to);
            const safeSubject = sanitizeText(subject);
            const safeMessage = sanitizeText(fullMessage);

            const args = ['send', safeTo, safeSubject, '--message', safeMessage];
            if (options.encrypt) {
                args.push('--encrypt');
            }

            const result = spawnSync('mycmail', args, {
                encoding: 'utf-8',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: sender }
            });

            if (result.error) {
                throw result.error;
            }

            const output = result.stdout || '';

            if (options.json) {
                // Try to parse mycmail output or create synthetic JSON
                // mycmail 1.0.0 output is text. 1.1.0 might have --json
                console.log(JSON.stringify({
                    status: 'sent',
                    to,
                    subject,
                    encrypted: !!options.encrypt,
                    original_output: output.trim()
                }, null, 2));
            } else {
                console.log(output);
            }
        } catch (error: any) {
            console.error('❌ Failed to send message via Myceliumail');
            console.error(error.message || error);
            process.exit(1);
        }
    });
