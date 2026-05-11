import { describe, it, expect } from 'vitest';
import { buildConflictGraph, calculateBlockingCounts, topologicalSort } from '../src/lib/graph.js';

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
