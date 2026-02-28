
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Define mocks first, using vi.hoisted to ensure they are available
const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    list: vi.fn(),
    execFileSync: vi.fn(),
    spawnSync: vi.fn(),
    loadConfig: vi.fn(),
}));

vi.mock('../../src/storage/index.js', () => ({
    getStorage: vi.fn().mockResolvedValue({
        isInitialized: vi.fn().mockResolvedValue(true),
        get: mocks.get,
        list: mocks.list,
    }),
}));

vi.mock('child_process', () => {
    return {
        execFileSync: mocks.execFileSync,
        spawnSync: mocks.spawnSync,
    }
});

vi.mock('../../src/lib/config.js', async () => {
    const actual = await vi.importActual('../../src/lib/config.js');
    return {
        ...actual,
        loadConfig: mocks.loadConfig,
    };
});

import { conflictsCommand } from '../../src/commands/conflicts.js';

describe('conflicts command security config', () => {
    const currentBranch = 'feature-a';
    const otherBranch = 'feature-b';

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.execFileSync.mockReturnValue(currentBranch);

        mocks.get.mockImplementation(async (name) => {
            if (name === currentBranch) {
                return { name: currentBranch, files: ['src/critical.ts'], status: 'active', registeredAt: new Date(), agent: 'agent-a' };
            }
            if (name === otherBranch) {
                return { name: otherBranch, files: ['src/critical.ts'], status: 'active', registeredAt: new Date(), agent: 'agent-b' };
            }
            return null;
        });

        mocks.list.mockResolvedValue([
            { name: currentBranch, files: ['src/critical.ts'], status: 'active', registeredAt: new Date(), agent: 'agent-a' },
            { name: otherBranch, files: ['src/critical.ts'], status: 'active', registeredAt: new Date(), agent: 'agent-b' },
        ]);
    });

    it('should BLOCK custom pattern if config is respected', async () => {
        const configMock = {
            conflicts: {
                highSeverityPatterns: ['critical\\.ts$'],
                mediumSeverityPatterns: [],
            },
            agent: {},
            ecosystem: {},
            autoWatch: {},
            readyCheck: {},
            storage: {}
        };
        mocks.loadConfig.mockResolvedValue(configMock);

        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);

        await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', '--strict', '--json']);

        const lastCall = logSpy.mock.calls[0];
        const output = JSON.parse(lastCall?.[0] || '{}');

        const conflict = output.conflicts?.find((c: any) => c.files.includes('src/critical.ts'));

        expect(conflict).toBeDefined();
        expect(conflict.tier).toBe(3);
        expect(output.summary.blocked).toBe(true);
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
