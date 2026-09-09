/**
 * The registry-overlap path of `conflicts` must never claim merge-readiness.
 *
 * `conflicts` without `--real` compares registered file lists. It runs no merge,
 * so it is structurally blind to add/add and content conflicts against the base —
 * yet it used to print "✅ You're good to merge!". Instance #5 of
 * treebird/knowledge/PATTERN_silent_success.md: "could not do the work" rendered
 * identically to "did the work, found nothing".
 *
 * This guards the LIVE emitter (src/commands/conflicts.ts). The parallel guard in
 * conflict-renderer.test.ts covers the DEEPENING-6 seam, which has no src/ caller
 * yet — deleting either one alone reopens half the hole.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { conflictsCommand } from '../src/commands/conflicts';
import { getStorage } from '../src/storage/index';
import { execFileSync } from 'child_process';

vi.mock('../src/storage/index', () => ({ getStorage: vi.fn() }));
vi.mock('../src/lib/config', () => ({ loadConfig: vi.fn(async () => ({})) }));
// Keep the cross-machine lookup off the network: no credentials => local-only,
// which is exactly the "fail-open, not degraded" case this path renders.
vi.mock('../src/lib/supabase-credentials', () => ({
    resolveSupabaseCredentials: vi.fn(async () => null),
}));
vi.mock('child_process', () => ({ execFileSync: vi.fn(), spawnSync: vi.fn() }));

let logSpy: ReturnType<typeof vi.spyOn>;

function logged(): string {
    return logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
}

async function run(args: string[]): Promise<void> {
    (conflictsCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    await conflictsCommand.parseAsync(['node', 'spidersan', 'conflicts', ...args]);
}

describe('conflicts (registry overlap) — zero-conflict output', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        // getCurrentBranch(); reconcile-on-read probes --is-ancestor, throw so the
        // other registered branch reads as still in flight.
        (execFileSync as Mock).mockImplementation((_cmd: string, args?: string[]) => {
            if (Array.isArray(args) && args.includes('--is-ancestor')) {
                throw new Error('not an ancestor');
            }
            return 'feat/current\n';
        });
        const mine = { name: 'feat/current', files: ['src/mine.ts'], status: 'active', registeredAt: new Date() };
        const other = { name: 'feat/other', files: ['src/theirs.ts'], status: 'active', registeredAt: new Date() };
        (getStorage as Mock).mockResolvedValue({
            isInitialized: vi.fn(async () => true),
            get: vi.fn(async () => mine),
            list: vi.fn(async () => [mine, other]),
        });
    });

    it('reports the scope that was checked, not a merge verdict', async () => {
        await run([]);

        const out = logged();
        expect(out).toContain('No registry overlap for "feat/current"');
        // "did the work" must be observable, not assumed.
        expect(out).toContain('vs 1 registered branch');
        expect(out).toContain('NOT a merge simulation');
    });

    it('never claims merge-readiness — registry overlap is not a merge', async () => {
        await run([]);

        expect(logged()).not.toMatch(/good to merge/i);
        expect(logged()).not.toMatch(/merges? clean/i);
    });
});
