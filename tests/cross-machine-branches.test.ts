import { describe, it, expect } from 'vitest';
import { crossMachineBranches } from '../src/commands/conflicts.js';
import type { Branch } from '../src/storage/adapter.js';
import type { MachineRegistryView } from '../src/types/cloud.js';

function view(machine_name: string, branches: Partial<Branch>[]): MachineRegistryView {
    return {
        machine_id: `${machine_name}-id`,
        machine_name,
        hostname: `${machine_name}.local`,
        repo_name: 'flockview',
        repo_path: `~/Dev/flockview`,
        last_synced: new Date(0).toISOString(),
        branches: branches.map(b => ({
            name: 'feat/x',
            files: ['README.md'],
            registeredAt: new Date(0),
            status: 'active' as const,
            ...b,
        })) as Branch[],
    };
}

/**
 * Guards the tb-ly0b fix: `conflicts` was local-registry-only, so a teammate on
 * another machine touching the same file was never flagged and the pre-push hook
 * reported a false all-clear.
 */
describe('crossMachineBranches', () => {
    it('surfaces another machine\'s active branches, machine-qualified', () => {
        const out = crossMachineBranches([view('m5', [{ name: 'test/conflict-a', files: ['README.md'] }])]);

        expect(out).toHaveLength(1);
        // Qualified so it can't be mistaken for a local branch of the same name.
        expect(out[0].name).toBe('m5/test/conflict-a');
        expect(out[0].files).toEqual(['README.md']);
    });

    it('drops non-active entries — finished work must not phantom-conflict', () => {
        const out = crossMachineBranches([view('m5', [
            { name: 'live', status: 'active' },
            { name: 'done', status: 'completed' },
            { name: 'dead', status: 'abandoned' },
        ])]);

        expect(out.map(b => b.name)).toEqual(['m5/live']);
    });

    it('drops file-less entries, which can never overlap', () => {
        const out = crossMachineBranches([view('m5', [
            { name: 'empty', files: [] },
            { name: 'real', files: ['src/index.ts'] },
        ])]);

        expect(out.map(b => b.name)).toEqual(['m5/real']);
    });

    it('keeps same-named branches on different machines distinct', () => {
        const out = crossMachineBranches([
            view('m5', [{ name: 'main', files: ['README.md'] }]),
            view('i7', [{ name: 'main', files: ['README.md'] }]),
        ]);

        expect(out.map(b => b.name)).toEqual(['m5/main', 'i7/main']);
    });

    it('returns nothing when no other machine has registered', () => {
        expect(crossMachineBranches([])).toEqual([]);
    });
});
