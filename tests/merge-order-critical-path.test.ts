/**
 * `merge-order --critical-path` must refuse a declared dependency cycle with a
 * non-zero exit, and plain `merge-order` must keep working on the same registry.
 * Asserting only the message would pass against a refusal that exits 0 — a check
 * that reports success while doing nothing.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { mergeOrderCommand } from '../src/commands/merge-order';
import { getStorage } from '../src/storage/index';

vi.mock('../src/storage/index', () => ({ getStorage: vi.fn() }));
vi.mock('../src/lib/reconcile', () => ({ activeBranches: (branches: unknown[]) => branches }));

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

const text = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => c.join(' ')).join('\n');

function registry(branches: Array<{ name: string; files?: string[]; dependsOn?: string[] }>) {
    (getStorage as Mock).mockResolvedValue({
        isInitialized: async () => true,
        list: async () => branches.map((b) => ({ status: 'active', files: [], ...b })),
    });
}

async function run(args: string[]): Promise<void> {
    (mergeOrderCommand as unknown as { _optionValues: Record<string, unknown> })._optionValues = {};
    await mergeOrderCommand.parseAsync(['node', 'spidersan', ...args]);
}

describe('merge-order --critical-path', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`exit ${code}`);
        }) as never);
    });

    it('exits 1 on a declared 2-cycle and names both edges', async () => {
        registry([
            { name: 'feature-a', dependsOn: ['feature-b'] },
            { name: 'feature-b', dependsOn: ['feature-a'] },
        ]);

        await expect(run(['--critical-path'])).rejects.toThrow('exit 1');
        expect(text(errorSpy)).toContain('feature-a depends on feature-b');
        expect(text(errorSpy)).toContain('feature-b depends on feature-a');
    });

    it('plain merge-order still succeeds on the same registry', async () => {
        registry([
            { name: 'feature-a', dependsOn: ['feature-b'] },
            { name: 'feature-b', dependsOn: ['feature-a'] },
        ]);

        await run([]);
        expect(text(logSpy)).toContain('Recommended Merge Order');
    });

    it('names a 3-cycle but not a branch that only sits downstream of it', async () => {
        registry([
            { name: 'ring-1', dependsOn: ['ring-3'] },
            { name: 'ring-2', dependsOn: ['ring-1'] },
            { name: 'ring-3', dependsOn: ['ring-2'] },
            { name: 'downstream', dependsOn: ['ring-2'] },
        ]);

        await expect(run(['--critical-path'])).rejects.toThrow('exit 1');
        const out = text(errorSpy);
        expect(out).toContain('ring-1 depends on ring-3');
        expect(out).toContain('ring-2 depends on ring-1');
        expect(out).toContain('ring-3 depends on ring-2');
        expect(out).not.toContain('downstream');
    });

    it('orders the head of the longest chain first, in JSON', async () => {
        registry([
            { name: 'fan' },
            ...['leaf-1', 'leaf-2', 'leaf-3'].map((name) => ({ name, dependsOn: ['fan'] })),
            { name: 'step-1' },
            { name: 'step-2', dependsOn: ['step-1'] },
            { name: 'step-3', dependsOn: ['step-2'] },
        ]);

        await run(['--critical-path', '--json']);
        const result = JSON.parse(text(logSpy));
        expect(result.order[0]).toMatchObject({ name: 'step-1', criticalPath: 2 });
        expect(result.droppedConflictEdges).toBe(0);
    });
});
