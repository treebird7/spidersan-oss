import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHubClient, type HubAdapter } from '../src/lib/hub.js';

describe('HubClient', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('notifyConflict does NOT post when all conflicts are tier 1', async () => {
        const adapter: HubAdapter = {
            postToChat: vi.fn(),
            wakeAgent: vi.fn(),
        };
        const hub = createHubClient({ adapter });

        await hub.notifyConflict('feature/test', [
            { branch: 'other-1', files: ['a.ts'], tier: 1 },
            { branch: 'other-2', files: ['b.ts'], tier: 1 },
        ]);

        expect(adapter.postToChat).not.toHaveBeenCalled();
    });

    it('notifyConflict posts when at least one tier 2 conflict', async () => {
        const adapter: HubAdapter = {
            postToChat: vi.fn().mockResolvedValue(undefined),
            wakeAgent: vi.fn(),
        };
        const hub = createHubClient({ adapter });

        await hub.notifyConflict('feature/test', [
            { branch: 'other-1', files: ['a.ts'], tier: 1 },
            { branch: 'other-2', files: ['b.ts'], tier: 2 },
        ]);

        expect(adapter.postToChat).toHaveBeenCalledTimes(1);
        expect(adapter.postToChat).toHaveBeenCalledWith(expect.objectContaining({
            agent: 'spidersan',
            name: 'Spidersan',
            glyph: '🕷️',
            message: expect.stringContaining('🟠 TIER 2 PAUSE'),
        }));
    });

    it('notifyConflict posts tier 3 severity label when tier 3 present', async () => {
        const adapter: HubAdapter = {
            postToChat: vi.fn().mockResolvedValue(undefined),
            wakeAgent: vi.fn(),
        };
        const hub = createHubClient({ adapter });

        await hub.notifyConflict('feature/test', [
            { branch: 'other-1', files: ['a.ts'], tier: 2 },
            { branch: 'other-2', files: ['b.ts'], tier: 3 },
        ]);

        expect(adapter.postToChat).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('🔴 TIER 3 BLOCK'),
        }));
    });

    it('wakeAgent calls wakeAgent on the adapter and returns true on success', async () => {
        const adapter: HubAdapter = {
            postToChat: vi.fn(),
            wakeAgent: vi.fn().mockResolvedValue(true),
        };
        const hub = createHubClient({ adapter });

        await expect(hub.wakeAgent('birdsan', 'Conflict detected')).resolves.toBe(true);
        expect(adapter.wakeAgent).toHaveBeenCalledWith('birdsan', {
            sender: 'spidersan',
            reason: 'Conflict detected',
        });
    });

    it('wakeAgent returns false silently when adapter throws', async () => {
        const adapter: HubAdapter = {
            postToChat: vi.fn(),
            wakeAgent: vi.fn().mockRejectedValue(new Error('offline')),
        };
        const hub = createHubClient({ adapter });

        await expect(hub.wakeAgent('birdsan', 'Conflict detected')).resolves.toBe(false);
    });

    it('postToChat calls through to adapter; silently ignores adapter errors', async () => {
        const successAdapter: HubAdapter = {
            postToChat: vi.fn().mockResolvedValue(undefined),
            wakeAgent: vi.fn(),
        };
        const successHub = createHubClient({ adapter: successAdapter });
        const payload = { message: 'hello', agent: 'spidersan', name: 'Spidersan', glyph: '🕷️' };

        await expect(successHub.postToChat(payload)).resolves.toBeUndefined();
        expect(successAdapter.postToChat).toHaveBeenCalledWith(payload);

        const failingAdapter: HubAdapter = {
            postToChat: vi.fn().mockRejectedValue(new Error('offline')),
            wakeAgent: vi.fn(),
        };
        const failingHub = createHubClient({ adapter: failingAdapter });

        await expect(failingHub.postToChat(payload)).resolves.toBeUndefined();
    });
});
