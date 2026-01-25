/**
 * Local JSON Message Storage Adapter (Tier 3)
 *
 * Stores messages in .spidersan/messages.json
 * This is the fallback when git and mycmail are unavailable.
 * Single-machine only - no cross-agent coordination.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type {
    MessageStorageAdapter,
    Message,
    SendMessageInput,
    InboxOptions,
    TierStatus,
} from './message-adapter.js';
import { generateMessageId } from './message-adapter.js';

const SPIDERSAN_DIR = '.spidersan';
const MESSAGES_FILE = 'messages.json';

interface MessagesRegistry {
    version: string;
    messages: Message[];
}

export class LocalMessagesAdapter implements MessageStorageAdapter {
    private basePath: string;
    private messagesPath: string;

    constructor(basePath: string = process.cwd()) {
        this.basePath = basePath;
        this.messagesPath = join(basePath, SPIDERSAN_DIR, MESSAGES_FILE);
    }

    getTier(): number {
        return 3;
    }

    getTierName(): string {
        return 'local-json';
    }

    async isAvailable(): Promise<boolean> {
        // Local storage is always available
        return true;
    }

    async getStatus(): Promise<TierStatus> {
        return {
            tier: 3,
            name: this.getTierName(),
            available: true,
            reason: 'Local JSON storage is always available',
        };
    }

    private async ensureDir(): Promise<void> {
        const dir = join(this.basePath, SPIDERSAN_DIR);
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true });
        }
    }

    private async load(): Promise<MessagesRegistry> {
        try {
            const data = await readFile(this.messagesPath, 'utf-8');
            const registry = JSON.parse(data) as MessagesRegistry;
            // Convert timestamp strings back to Date objects
            registry.messages = registry.messages.map(msg => ({
                ...msg,
                timestamp: new Date(msg.timestamp),
            }));
            return registry;
        } catch {
            return { version: '1.0', messages: [] };
        }
    }

    private async save(registry: MessagesRegistry): Promise<void> {
        await this.ensureDir();
        await writeFile(this.messagesPath, JSON.stringify(registry, null, 2));
    }

    async send(input: SendMessageInput): Promise<Message> {
        const registry = await this.load();

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

        registry.messages.push(message);
        await this.save(registry);

        return message;
    }

    async inbox(agentId: string, options: InboxOptions = {}): Promise<Message[]> {
        const registry = await this.load();

        let messages = registry.messages.filter(msg => msg.to === agentId);

        // Sort by timestamp descending (newest first)
        messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        if (options.unread) {
            messages = messages.filter(msg => !msg.read);
        }

        if (options.limit && options.limit > 0) {
            messages = messages.slice(0, options.limit);
        }

        return messages;
    }

    async read(messageId: string): Promise<Message | null> {
        const registry = await this.load();
        const message = registry.messages.find(msg => msg.id === messageId);
        return message || null;
    }

    async markRead(messageId: string): Promise<boolean> {
        const registry = await this.load();
        const message = registry.messages.find(msg => msg.id === messageId);

        if (!message) {
            return false;
        }

        message.read = true;
        await this.save(registry);
        return true;
    }

    /**
     * Get sent messages (outbox) for an agent
     */
    async outbox(agentId: string, options: InboxOptions = {}): Promise<Message[]> {
        const registry = await this.load();

        let messages = registry.messages.filter(msg => msg.from === agentId);

        // Sort by timestamp descending (newest first)
        messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        if (options.limit && options.limit > 0) {
            messages = messages.slice(0, options.limit);
        }

        return messages;
    }

    /**
     * Delete a message
     */
    async delete(messageId: string): Promise<boolean> {
        const registry = await this.load();
        const index = registry.messages.findIndex(msg => msg.id === messageId);

        if (index === -1) {
            return false;
        }

        registry.messages.splice(index, 1);
        await this.save(registry);
        return true;
    }

    /**
     * Clean up old messages
     */
    async cleanup(olderThan: Date): Promise<number> {
        const registry = await this.load();
        const originalCount = registry.messages.length;

        registry.messages = registry.messages.filter(
            msg => msg.timestamp >= olderThan
        );

        const removed = originalCount - registry.messages.length;
        if (removed > 0) {
            await this.save(registry);
        }

        return removed;
    }
}
