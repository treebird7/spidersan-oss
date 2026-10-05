/**
 * SPIDERSAN_CORE_ONLY must mean "core only": =1/true keeps the optional
 * spidersan-ecosystem plugin out; =0/unset lets it load. The original check ran
 * CORE_ONLY through the same "is it 0/false" test as SPIDERSAN_ECOSYSTEM, so
 * CORE_ONLY=0 disabled the plugin and CORE_ONLY=1 did nothing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';

const mocks = vi.hoisted(() => ({ getCommands: vi.fn() }));

vi.mock('spidersan-ecosystem', () => ({ getCommands: mocks.getCommands }));
vi.mock('../src/lib/config.js', async () => {
    const actual = await vi.importActual<typeof import('../src/lib/config.js')>('../src/lib/config.js');
    return { ...actual, loadConfig: vi.fn().mockResolvedValue({ ecosystem: { enabled: true } }) };
});

import { loadEcosystemCommands } from '../src/commands/ecosystem-loader.js';

beforeEach(() => {
    vi.stubEnv('SPIDERSAN_ECOSYSTEM', '');
    vi.stubEnv('SPIDERSAN_CORE_ONLY', '');
    mocks.getCommands.mockReset();
    mocks.getCommands.mockReturnValue([new Command('plugin-cmd')]);
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('ecosystem plugin env switches', () => {
    it('unset: plugin commands load', async () => {
        const cmds = await loadEcosystemCommands();
        expect(cmds.map((c) => c.name())).toEqual(['plugin-cmd']);
    });

    it('SPIDERSAN_CORE_ONLY=1: plugin disabled', async () => {
        vi.stubEnv('SPIDERSAN_CORE_ONLY', '1');
        expect(await loadEcosystemCommands()).toEqual([]);
        expect(mocks.getCommands).not.toHaveBeenCalled();
    });

    it('SPIDERSAN_CORE_ONLY=true: plugin disabled', async () => {
        vi.stubEnv('SPIDERSAN_CORE_ONLY', 'true');
        expect(await loadEcosystemCommands()).toEqual([]);
    });

    it('SPIDERSAN_CORE_ONLY=0: plugin allowed', async () => {
        vi.stubEnv('SPIDERSAN_CORE_ONLY', '0');
        const cmds = await loadEcosystemCommands();
        expect(cmds.map((c) => c.name())).toEqual(['plugin-cmd']);
    });

    it('SPIDERSAN_ECOSYSTEM=0: plugin disabled', async () => {
        vi.stubEnv('SPIDERSAN_ECOSYSTEM', '0');
        expect(await loadEcosystemCommands()).toEqual([]);
    });

    it('SPIDERSAN_ECOSYSTEM as a path list: plugin allowed', async () => {
        vi.stubEnv('SPIDERSAN_ECOSYSTEM', '/tmp/repo-a:/tmp/repo-b');
        const cmds = await loadEcosystemCommands();
        expect(cmds.map((c) => c.name())).toEqual(['plugin-cmd']);
    });
});
