/**
 * Message Storage Adapter Interface
 *
 * Abstract interface for tiered message storage.
 * Implementations:
 *   Tier 1: MycmailAdapter (real-time, full features via Supabase)
 *   Tier 2: GitMessagesAdapter (git orphan branch coordination)
 *   Tier 3: LocalMessagesAdapter (single-machine fallback)
 */

export type MessageType = 'info' | 'question' | 'alert' | 'handoff' | 'file_share';

export interface Message {
    id: string;
    from: string;
    to: string;
    subject: string;
    body: string;
    timestamp: Date;
    type: MessageType;
    encrypted: boolean;
    read: boolean;
    branch?: string;
    files?: string[];
}

export interface SendMessageInput {
    from: string;
    to: string;
    subject: string;
    body: string;
    type?: MessageType;
    encrypted?: boolean;
    branch?: string;
    files?: string[];
}

export interface InboxOptions {
    unread?: boolean;
    limit?: number;
}

export interface TierStatus {
    tier: number;
    name: string;
    available: boolean;
    reason?: string;
}

export interface MessageStorageAdapter {
    /**
     * Get the tier number (1 = highest priority, 3 = lowest)
     */
    getTier(): number;

    /**
     * Get the human-readable tier name
     */
    getTierName(): string;

    /**
     * Check if this storage backend is available
     */
    isAvailable(): Promise<boolean>;

    /**
     * Get detailed availability status
     */
    getStatus(): Promise<TierStatus>;

    /**
     * Send a message
     */
    send(message: SendMessageInput): Promise<Message>;

    /**
     * Get inbox messages for an agent
     */
    inbox(agentId: string, options?: InboxOptions): Promise<Message[]>;

    /**
     * Read a specific message by ID
     */
    read(messageId: string): Promise<Message | null>;

    /**
     * Mark a message as read
     */
    markRead(messageId: string): Promise<boolean>;
}

/**
 * Generate a unique message ID
 */
export function generateMessageId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `msg_${timestamp}_${random}`;
}

/**
 * Create a slug from subject for file naming
 */
export function subjectToSlug(subject: string): string {
    return subject
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 30);
}
