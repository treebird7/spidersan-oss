import { describe, expect, it } from 'vitest';
import { renderConflictReport } from '../src/lib/conflict-renderer.js';
import type { Conflict, ConflictReport } from '../src/lib/conflict-analyzer.js';

function createReport(conflicts: Conflict[]): ConflictReport {
    return {
        conflicts,
        highest: conflicts.length > 0
            ? conflicts.reduce((max, conflict) => (conflict.tier > max ? conflict.tier : max), 1 as 1 | 2 | 3)
            : 1,
        shouldBlock: conflicts.some((conflict) => conflict.tier === 3),
        byTier: {
            1: conflicts.filter((conflict) => conflict.tier === 1),
            2: conflicts.filter((conflict) => conflict.tier === 2),
            3: conflicts.filter((conflict) => conflict.tier === 3),
        },
    };
}

function createConflict(overrides: Partial<Conflict> = {}): Conflict {
    return {
        file: 'src/profile.ts',
        tier: 1,
        branches: [{ name: 'feature-b', agent: 'agent-b' }],
        classifierSource: 'path',
        recommendation: 'Consider coordinating, but safe to proceed.',
        ...overrides,
    };
}

describe('renderConflictReport', () => {
    it('renders a no-conflicts summary for an empty report', () => {
        const output = renderConflictReport(createReport([]));

        expect(output).toContain('No conflicts detected');
        expect(output).toContain('You\'re good to merge!');
    });

    it('renders the tier 1 icon and label', () => {
        const output = renderConflictReport(createReport([
            createConflict(),
        ]));

        expect(output).toContain('🟡 TIER 1 (WARN): feature-b');
    });

    it('renders the tier 2 icon and label', () => {
        const output = renderConflictReport(createReport([
            createConflict({
                file: 'src/config.ts',
                tier: 2,
                recommendation: 'Coordinate with other agent before proceeding.',
            }),
        ]));

        expect(output).toContain('🟠 TIER 2 (PAUSE): feature-b');
    });

    it('renders the tier 3 icon and BLOCK label', () => {
        const output = renderConflictReport(createReport([
            createConflict({
                file: 'src/auth.ts',
                tier: 3,
                recommendation: 'Merge blocked. Resolve conflict first.',
            }),
        ]));

        expect(output).toContain('🔴 TIER 3 (BLOCK): feature-b');
    });

    it('renders symbolsOverlap when verbose is enabled', () => {
        const output = renderConflictReport(createReport([
            createConflict({
                tier: 3,
                classifierSource: 'symbol',
                symbolsOverlap: ['setSecret', 'rotateToken'],
            }),
        ]), { verbose: true });

        expect(output).toContain('symbols: setSecret, rotateToken');
    });

    it('omits symbolsOverlap in non-verbose mode', () => {
        const output = renderConflictReport(createReport([
            createConflict({
                tier: 3,
                classifierSource: 'symbol',
                symbolsOverlap: ['setSecret'],
            }),
        ]));

        expect(output).not.toContain('symbols:');
        expect(output).not.toContain('setSecret');
    });

    it('returns the same string for the same report every time', () => {
        const report = createReport([
            createConflict({
                file: 'docs/plan.md',
                branches: [
                    { name: 'feature-b', agent: 'agent-b' },
                    { name: 'feature-c', agent: 'agent-c' },
                ],
            }),
            createConflict({
                file: 'src/auth.ts',
                tier: 3,
                branches: [{ name: 'feature-c', agent: 'agent-c' }],
                recommendation: 'Merge blocked. Resolve conflict first.',
            }),
        ]);

        expect(renderConflictReport(report, { verbose: true })).toBe(
            renderConflictReport(report, { verbose: true }),
        );
    });
});
