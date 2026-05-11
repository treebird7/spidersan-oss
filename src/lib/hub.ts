export interface ChatPayload {
    message: string;
    agent?: string;
    name?: string;
    glyph?: string;
}

export interface WakePayload {
    sender: string;
    reason: string;
}

export interface HubAdapter {
    postToChat(payload: ChatPayload): Promise<void>;
    wakeAgent(agentId: string, payload: WakePayload): Promise<boolean>;
}

const DEFAULT_HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';

function warnHubError(action: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`⚠️ Hub ${action} failed: ${message}`);
}

class FetchHubAdapter implements HubAdapter {
    constructor(private readonly url: string) {}

    async postToChat(payload: ChatPayload): Promise<void> {
        try {
            const response = await fetch(`${this.url}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                console.warn(`⚠️ Hub chat post failed: ${response.status}`);
            }
        } catch (error) {
            warnHubError('chat post', error);
        }
    }

    async wakeAgent(agentId: string, payload: WakePayload): Promise<boolean> {
        try {
            const response = await fetch(`${this.url}/api/wake/${encodeURIComponent(agentId)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                console.warn(`⚠️ Hub wake failed for ${agentId}: ${response.status}`);
            }

            return response.ok;
        } catch (error) {
            warnHubError(`wake for ${agentId}`, error);
            return false;
        }
    }
}

export class HubClient {
    public readonly url: string;

    constructor(
        private readonly adapter: HubAdapter,
        url: string = DEFAULT_HUB_URL,
    ) {
        this.url = url;
    }

    async postToChat(payload: ChatPayload): Promise<void> {
        try {
            await this.adapter.postToChat(payload);
        } catch (error) {
            warnHubError('chat post', error);
        }
    }

    async notifyConflict(
        branch: string,
        conflicts: Array<{ branch: string; files: string[]; tier: number }>,
    ): Promise<void> {
        const actionableConflicts = conflicts.filter((conflict) => conflict.tier >= 2);
        if (actionableConflicts.length === 0) return;

        const severity = actionableConflicts.some((conflict) => conflict.tier === 3)
            ? '🔴 TIER 3 BLOCK'
            : '🟠 TIER 2 PAUSE';
        const message = `🕷️⚠️ **Conflict Alert** on \`${branch}\`\n\n${severity}\n\nConflicting files require coordination.`;

        await this.postToChat({
            agent: 'spidersan',
            name: 'Spidersan',
            message,
            glyph: '🕷️',
        });
    }

    async wakeAgent(agentId: string, reason: string): Promise<boolean> {
        try {
            return await this.adapter.wakeAgent(agentId, {
                sender: 'spidersan',
                reason,
            });
        } catch (error) {
            warnHubError(`wake for ${agentId}`, error);
            return false;
        }
    }
}

export function createHubClient(options: {
    url?: string;
    adapter?: HubAdapter;
} = {}): HubClient {
    const url = options.url || DEFAULT_HUB_URL;
    const adapter = options.adapter || new FetchHubAdapter(url);
    return new HubClient(adapter, url);
}
