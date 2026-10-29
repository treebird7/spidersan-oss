import { describe, it, expect } from 'vitest';
import {
    addDependencyEdges,
    buildConflictGraph,
    buildDeclaredGraph,
    calculateBlockingCounts,
    calculateCriticalPath,
    orientForMeasurement,
    topologicalSort,
} from '../src/lib/graph.js';

describe('buildConflictGraph', () => {
    it('returns empty adjacency lists for branches with no file overlap', () => {
        const graph = buildConflictGraph([
            { name: 'alpha', files: ['src/a.ts'] },
            { name: 'beta', files: ['src/b.ts'] },
        ]);

        expect(graph.get('alpha')).toEqual([]);
        expect(graph.get('beta')).toEqual([]);
    });

    it('links two branches that share a file', () => {
        const graph = buildConflictGraph([
            { name: 'alpha', files: ['src/shared.ts', 'src/a.ts'] },
            { name: 'beta', files: ['src/shared.ts', 'src/b.ts'] },
        ]);

        expect(graph.get('alpha')).toEqual(['beta']);
        expect(graph.get('beta')).toEqual(['alpha']);
    });

    it('does not link a branch to itself', () => {
        const graph = buildConflictGraph([
            { name: 'alpha', files: ['src/shared.ts', 'src/shared.ts'] },
        ]);

        expect(graph.get('alpha')).toEqual([]);
    });
});

describe('addDependencyEdges', () => {
    it('orders a dependency before its dependent in the sort', () => {
        // no file overlap, but child declares it depends on parent
        const branches = [
            { name: 'a-child', files: ['src/c.ts'], dependsOn: ['z-parent'] },
            { name: 'z-parent', files: ['src/p.ts'] },
        ];
        const graph = addDependencyEdges(buildConflictGraph(branches), branches);
        const order = topologicalSort(branches.map(b => b.name), graph);

        // alphabetical order would put a-child first; the dep edge overrides
        expect(order).toEqual(['z-parent', 'a-child']);
    });

    it('wins over the symmetric conflict edge for stacked branches (file overlap + dep)', () => {
        // stacked branches ALWAYS file-overlap → symmetric 2-cycle in the
        // conflict graph. The declared dep must break the cycle, not join it.
        // (Live repro 2026-07-11: spider2/cloud-branch-state sorted BEFORE its
        // base spider2/study-improve-core because 'c' < 's' in cycle-breaking.)
        const branches = [
            { name: 'a-stacked', files: ['src/shared.ts'], dependsOn: ['z-base'] },
            { name: 'z-base', files: ['src/shared.ts'] },
        ];
        const graph = addDependencyEdges(buildConflictGraph(branches), branches);
        const order = topologicalSort(branches.map(b => b.name), graph);

        expect(order).toEqual(['z-base', 'a-stacked']);
    });

    it('does not mutate the input graph and ignores unknown deps', () => {
        const branches = [{ name: 'a', files: [], dependsOn: ['ghost'] }];
        const base = buildConflictGraph(branches);
        const merged = addDependencyEdges(base, branches);

        expect(base.get('ghost')).toBeUndefined();
        expect(merged.get('ghost')).toEqual(['a']);
        // unknown node is dropped by normalization inside the sort
        expect(topologicalSort(['a'], merged)).toEqual(['a']);
    });
});

describe('topologicalSort', () => {
    it('returns single node unchanged', () => {
        const nodes = ['alpha'];
        const graph = new Map([['alpha', []]]);

        expect(topologicalSort(nodes, graph)).toEqual(['alpha']);
    });

    it('returns independent nodes in stable order', () => {
        const nodes = ['alpha', 'beta', 'gamma'];
        const graph = new Map([
            ['alpha', []],
            ['beta', []],
            ['gamma', []],
        ]);

        expect(topologicalSort(nodes, graph)).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('places non-conflicting branch before conflicting branch', () => {
        const nodes = ['solo', 'alpha', 'beta'];
        const graph = new Map([
            ['solo', []],
            ['alpha', ['beta']],
            ['beta', ['alpha']],
        ]);

        const order = topologicalSort(nodes, graph);

        expect(order[0]).toBe('solo');
        expect(order).toHaveLength(3);
    });

    it('handles cycle gracefully', () => {
        const nodes = ['alpha', 'beta', 'gamma'];
        const graph = new Map([
            ['alpha', ['beta']],
            ['beta', ['gamma']],
            ['gamma', ['alpha']],
        ]);

        expect(() => topologicalSort(nodes, graph)).not.toThrow();
        expect(topologicalSort(nodes, graph).slice().sort()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('uses blocking counts to break ties', () => {
        const nodes = ['alpha', 'beta', 'gamma'];
        const graph = new Map([
            ['alpha', []],
            ['beta', []],
            ['gamma', []],
        ]);
        const blockingCounts = new Map([
            ['alpha', 1],
            ['beta', 3],
            ['gamma', 2],
        ]);

        expect(topologicalSort(nodes, graph, blockingCounts)).toEqual(['beta', 'gamma', 'alpha']);
    });
});

describe('calculateBlockingCounts', () => {
    it('returns 0 for node with no outgoing edges', () => {
        const nodes = ['alpha'];
        const graph = new Map([['alpha', []]]);

        expect(calculateBlockingCounts(nodes, graph).get('alpha')).toBe(0);
    });

    it('returns correct count for hub node', () => {
        const nodes = ['hub', 'alpha', 'beta', 'gamma'];
        const graph = new Map([
            ['hub', ['alpha', 'beta', 'gamma']],
            ['alpha', []],
            ['beta', []],
            ['gamma', []],
        ]);

        const counts = calculateBlockingCounts(nodes, graph);

        expect(counts.get('hub')).toBe(3);
        expect(counts.get('alpha')).toBe(0);
        expect(counts.get('beta')).toBe(0);
        expect(counts.get('gamma')).toBe(0);
    });

    it('counts transitively blocked nodes', () => {
        const nodes = ['alpha', 'beta', 'gamma'];
        const graph = new Map([
            ['alpha', ['beta']],
            ['beta', ['gamma']],
            ['gamma', []],
        ]);

        const counts = calculateBlockingCounts(nodes, graph);

        expect(counts.get('alpha')).toBe(2);
        expect(counts.get('beta')).toBe(1);
        expect(counts.get('gamma')).toBe(0);
    });
});

/** Every edge u→v has u before v. */
function isTopological(order: string[], graph: Map<string, string[]>): boolean {
    const position = new Map(order.map((node, i) => [node, i] as const));
    return [...graph].every(([node, out]) => out.every((next) => position.get(node)! < position.get(next)!));
}

describe('calculateCriticalPath', () => {
    // fan: one node unblocking 8 leaves. chain-1 heads chain-1 → … → chain-5.
    const leaves = Array.from({ length: 8 }, (_, i) => `leaf-${i}`);
    const chain = ['chain-1', 'chain-2', 'chain-3', 'chain-4', 'chain-5'];
    const nodes = ['fan', ...leaves, ...chain];
    const graph = new Map<string, string[]>(nodes.map((n) => [n, []]));
    graph.set('fan', leaves);
    chain.slice(0, -1).forEach((n, i) => graph.set(n, [chain[i + 1]]));

    it('puts the chain head first where blocking count puts the fan-out first', () => {
        const blocking = calculateBlockingCounts(nodes, graph);
        const critical = calculateCriticalPath(nodes, graph);

        expect(blocking.get('fan')).toBe(8);
        expect(blocking.get('chain-1')).toBe(4);
        expect(critical.get('fan')).toBe(1);
        expect(critical.get('chain-1')).toBe(4);

        const byBlocking = topologicalSort(nodes, graph, blocking);
        const byCritical = topologicalSort(nodes, graph, critical, blocking);

        expect(byBlocking[0]).toBe('fan');
        expect(byCritical[0]).toBe('chain-1');
        expect(isTopological(byBlocking, graph)).toBe(true);
        expect(isTopological(byCritical, graph)).toBe(true);
    });

    it('throws on a cycle instead of truncating the path', () => {
        const cyclic = new Map([['a', ['b']], ['b', ['a']]]);
        expect(() => calculateCriticalPath(['a', 'b'], cyclic)).toThrow(/cycle/);
    });
});

describe('orientForMeasurement', () => {
    it('keeps a declared edge the plain sort would point backward', () => {
        // conflicts a↔b↔z, declared: a depends on z. The plain sort gives a, b, z.
        const branches = [
            { name: 'a', files: ['x.ts'], dependsOn: ['z'] },
            { name: 'b', files: ['x.ts', 'y.ts'] },
            { name: 'z', files: ['y.ts', 'x.ts'] },
        ];
        const nodes = branches.map((b) => b.name);
        const result = orientForMeasurement(nodes, buildDeclaredGraph(branches), buildConflictGraph(branches));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.graph.get('z')).toContain('a');
        expect(result.graph.get('a')).not.toContain('z');
        expect(isTopological(result.order, result.graph)).toBe(true);
        // a↔b and b↔z had no declared order; a↔z did.
        expect(result.droppedConflictEdges).toBe(2);
    });

    it('reports a declared 2-cycle with both edges', () => {
        const branches = [
            { name: 'a', files: [], dependsOn: ['b'] },
            { name: 'b', files: [], dependsOn: ['a'] },
        ];
        const result = orientForMeasurement(['a', 'b'], buildDeclaredGraph(branches), new Map());

        expect(result).toEqual({
            ok: false,
            cycles: [[{ dependent: 'a', dependency: 'b' }, { dependent: 'b', dependency: 'a' }]],
        });
    });

    it('ignores deps on unregistered or merged branches', () => {
        const branches = [{ name: 'a', files: [], dependsOn: ['gone'] }];
        const result = orientForMeasurement(['a'], buildDeclaredGraph(branches), new Map());
        expect(result.ok).toBe(true);
    });
});
