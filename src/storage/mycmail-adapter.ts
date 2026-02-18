/**
 * Mycmail Message Storage Adapter (Tier 1)
 *
 * Wraps the existing mycmail CLI for Supabase-backed messaging.
 * This is the highest tier with real-time, full features.
 */

import { execSync, spawnSync } from 'child_process';
import type {
    MessageStorageAdapter,
    Message,
    SendMessageInput,
    InboxOptions,
    TierStatus,
    MessageType,
} from './message-adapter.js';
import { generateMessageId } from './message-adapter.js';

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

export class MycmailAdapter implements MessageStorageAdapter {
    private agentId: string;
    private mycmailAvailable: boolean | null = null;
    private supabaseAvailable: boolean | null = null;

    constructor(agentId?: string) {
        this.agentId = agentId || process.env.SPIDERSAN_AGENT || 'cli-agent';
    }

    getTier(): number {
        return 1;
    }

    getTierName(): string {
        return 'mycmail-supabase';
    }

    /**
     * Check if mycmail CLI is installed
     */
    private isMycmailInstalled(): boolean {
        if (this.mycmailAvailable !== null) {
            return this.mycmailAvailable;
        }

        try {
            execSync('which mycmail', { stdio: 'ignore' });
            this.mycmailAvailable = true;
            return true;
        } catch {
            this.mycmailAvailable = false;
            return false;
        }
    }

    /**
     * Check if Supabase is configured and responding
     */
    private async isSupabaseAvailable(): Promise<boolean> {
        if (this.supabaseAvailable !== null) {
            return this.supabaseAvailable;
        }

        // Check for Supabase environment variables
        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
            this.supabaseAvailable = false;
            return false;
        }

        // Try a simple mycmail command to verify connectivity
        try {
            const result = spawnSync('mycmail', ['inbox'], {
                encoding: 'utf-8',
                env: { ...process.env, MYCELIUMAIL_AGENT_ID: this.agentId },
                timeout: 5000, // 5 second timeout
            });

            // If mycmail works without error, Supabase is available
            this.supabaseAvailable = result.status === 0;
            return this.supabaseAvailable;
        } catch {
            this.supabaseAvailable = false;
            return false;
        }
    }

    async isAvailable(): Promise<boolean> {
        if (!this.isMycmailInstalled()) {
            return false;
        }
        return this.isSupabaseAvailable();
    }

    async getStatus(): Promise<TierStatus> {
        if (!this.isMycmailInstalled()) {
            return {
                tier: 1,
                name: this.getTierName(),
                available: false,
                reason: 'mycmail CLI not installed (npm install -g myceliumail)',
            };
        }

        if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
            return {
                tier: 1,
                name: this.getTierName(),
                available: false,
                reason: 'SUPABASE_URL and SUPABASE_KEY not configured',
            };
        }

        const supabaseUp = await this.isSupabaseAvailable();
        if (!supabaseUp) {
            return {
                tier: 1,
                name: this.getTierName(),
                available: false,
                reason: 'Supabase not responding',
            };
        }

        return {
            tier: 1,
            name: this.getTierName(),
            available: true,
            reason: 'Mycmail + Supabase available',
        };
    }

    /**
     * Format message body with Spidersan context
     */
    private formatMessageBody(input: SendMessageInput): string {
        let contextHeader = '';

        if (input.type && input.type !== 'info') {
            contextHeader += `Type: ${input.type}\n`;
        }
        if (input.branch) {
            contextHeader += `Branch: ${input.branch}\n`;
        }
        if (input.files && input.files.length > 0) {
            contextHeader += `Files: ${input.files.join(', ')}\n`;
        }

        return contextHeader ? `${contextHeader}\n${input.body}` : input.body;
    }

    /**
     * Parse message body to extract Spidersan context
     */
    private parseMessageBody(rawBody: string): {
        body: string;
        type: MessageType;
        branch?: string;
        files?: string[];
    } {
        const lines = rawBody.split('\n');
        let body = rawBody;
        let type: MessageType = 'info';
        let branch: string | undefined;
        let files: string[] | undefined;

        // Look for context header
        let headerEnd = 0;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('Type: ')) {
                type = line.substring(6) as MessageType;
                headerEnd = i + 1;
            } else if (line.startsWith('Branch: ')) {
                branch = line.substring(8);
                headerEnd = i + 1;
            } else if (line.startsWith('Files: ')) {
                files = line.substring(7).split(', ');
                headerEnd = i + 1;
            } else if (line === '' && headerEnd > 0) {
                // Empty line after headers - skip it
                headerEnd = i + 1;
                break;
            } else if (headerEnd === 0) {
                // No header found
                break;
            }
        }

        if (headerEnd > 0) {
            body = lines.slice(headerEnd).join('\n');
        }

        return { body, type, branch, files };
    }

    async send(input: SendMessageInput): Promise<Message> {
        const safeTo = validateAgentId(input.to);
        const safeSubject = sanitizeText(input.subject);
        const fullMessage = this.formatMessageBody(input);
        const safeMessage = sanitizeText(fullMessage);

        const args = ['send', safeTo, safeSubject, '--message', safeMessage];
        if (input.encrypted) {
            args.push('--encrypt');
        }

        const result = spawnSync('mycmail', args, {
            encoding: 'utf-8',
            env: { ...process.env, MYCELIUMAIL_AGENT_ID: input.from },
        });

        if (result.error) {
            throw result.error;
        }

        if (result.status !== 0) {
            throw new Error(`mycmail send failed: ${result.stderr || result.stdout}`);
        }

        // Create synthetic message object since mycmail doesn't return structured data
        const message: Message = {
            id: generateMessageId(),
            from: input.from,
            to: input.to,
            subject: input.subject,
            body: input.body,
            timestamp: new Date(),
            type: input.type || 'info',
            encrypted: input.encrypted || false,
            read: false,
            branch: input.branch,
            files: input.files,
        };

        return message;
    }

    async inbox(agentId: string, options: InboxOptions = {}): Promise<Message[]> {
        const safeAgentId = validateAgentId(agentId);

        const result = spawnSync('mycmail', ['inbox', '--json'], {
            encoding: 'utf-8',
            env: { ...process.env, MYCELIUMAIL_AGENT_ID: safeAgentId },
        });

        if (result.error) {
            throw result.error;
        }

        // Try to parse JSON output
        try {
            const data = JSON.parse(result.stdout);

            // Map mycmail format to our Message format
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const rawMessages = (data.messages || data || []);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let messages: Message[] = rawMessages.map((msg: any) => {
                const parsed = this.parseMessageBody(msg.body || msg.content || '');
                return {
                    id: msg.id || generateMessageId(),
                    from: msg.from || msg.sender || 'unknown',
                    to: msg.to || msg.recipient || agentId,
                    subject: msg.subject || '(no subject)',
                    body: parsed.body,
                    timestamp: new Date(msg.timestamp || msg.created_at || Date.now()),
                    type: parsed.type,
                    encrypted: msg.encrypted || false,
                    read: msg.read || false,
                    branch: parsed.branch,
                    files: parsed.files,
                };
            });

            // Sort by timestamp descending
            messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

            if (options.unread) {
                messages = messages.filter(msg => !msg.read);
            }

            if (options.limit && options.limit > 0) {
                messages = messages.slice(0, options.limit);
            }

            return messages;
        } catch {
            // If JSON parsing fails, return empty array
            // (mycmail might not support --json yet)
            return [];
        }
    }

    async read(messageId: string): Promise<Message | null> {
        // Validate message ID format
        const VALID_MESSAGE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,64}$/;
        if (!VALID_MESSAGE_ID.test(messageId)) {
            throw new Error(`Invalid message ID: "${messageId.slice(0, 20)}..."`);
        }

        const result = spawnSync('mycmail', ['read', messageId, '--json'], {
            encoding: 'utf-8',
            env: { ...process.env, MYCELIUMAIL_AGENT_ID: this.agentId },
        });

        if (result.error) {
            throw result.error;
        }

        if (result.status !== 0) {
            return null;
        }

        try {
            const msg = JSON.parse(result.stdout);
            const parsed = this.parseMessageBody(msg.body || msg.content || '');

            return {
                id: msg.id || messageId,
                from: msg.from || msg.sender || 'unknown',
                to: msg.to || msg.recipient || this.agentId,
                subject: msg.subject || '(no subject)',
                body: parsed.body,
                timestamp: new Date(msg.timestamp || msg.created_at || Date.now()),
                type: parsed.type,
                encrypted: msg.encrypted || false,
                read: true, // Reading marks it as read
                branch: parsed.branch,
                files: parsed.files,
            };
        } catch {
            return null;
        }
    }

    async markRead(messageId: string): Promise<boolean> {
        // mycmail's read command automatically marks as read
        const message = await this.read(messageId);
        return message !== null;
    }
}
