import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASTParser } from '../src/lib/ast.js';
import { analyzeConflicts } from '../src/lib/conflict-analyzer.js';

describe('analyzeConflicts', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('reports overlapping files by tier and branch', () => {
        const report = analyzeConflicts({
            branches: [
                {
                    name: 'feature-b',
                    files: ['src/auth.ts', 'src/profile.ts'],
                    status: 'active',
                    registeredAt: new Date(),
                    agent: 'agent-b',
                },
                {
                    name: 'feature-c',
                    files: ['src/profile.ts'],
                    status: 'active',
                    registeredAt: new Date(),
                    agent: 'agent-c',
                },
                {
                    name: 'feature-d',
                    files: ['src/auth.ts'],
                    status: 'completed',
                    registeredAt: new Date(),
                    agent: 'agent-d',
                },
            ],
            targetFiles: ['src/profile.ts', 'src/auth.ts', 'src/solo.ts'],
        });

        expect(report.highest).toBe(3);
        expect(report.shouldBlock).toBe(true);
        expect(report.conflicts).toEqual([
            {
                file: 'src/profile.ts',
                tier: 1,
                branches: [
                    { name: 'feature-b', agent: 'agent-b' },
                    { name: 'feature-c', agent: 'agent-c' },
                ],
                classifierSource: 'path',
                recommendation: 'Consider coordinating, but safe to proceed.',
            },
            {
                file: 'src/auth.ts',
                tier: 3,
                branches: [{ name: 'feature-b', agent: 'agent-b' }],
                classifierSource: 'path',
                recommendation: 'Merge blocked. Resolve conflict first.',
            },
        ]);
        expect(report.byTier[1]).toHaveLength(1);
        expect(report.byTier[2]).toHaveLength(0);
        expect(report.byTier[3]).toHaveLength(1);
    });

    it('promotes a conflict tier when symbol-aware classification finds sensitive symbols', () => {
        vi.spyOn(ASTParser.prototype, 'getSymbols').mockReturnValue([
            {
                name: 'setSecret',
                type: 'function',
                startLine: 1,
                endLine: 3,
            },
        ]);

        const report = analyzeConflicts({
            branches: [
                {
                    name: 'feature-b',
                    files: ['src/profile.ts'],
                    status: 'active',
                    registeredAt: new Date(),
                },
            ],
            targetFiles: ['src/profile.ts'],
            options: { useSymbolAware: true },
        });

        expect(report.highest).toBe(3);
        expect(report.shouldBlock).toBe(true);
        expect(report.conflicts[0]).toMatchObject({
            file: 'src/profile.ts',
            tier: 3,
            classifierSource: 'symbol',
            symbolsOverlap: ['setSecret'],
        });
    });

    it('falls back to path classification when symbol analysis fails', () => {
        vi.spyOn(ASTParser.prototype, 'getSymbols').mockImplementation(() => {
            throw new Error('parse failure');
        });

        const report = analyzeConflicts({
            branches: [
                {
                    name: 'feature-b',
                    files: ['src/config.ts'],
                    status: 'active',
                    registeredAt: new Date(),
                },
            ],
            targetFiles: ['src/config.ts'],
            options: { useSymbolAware: true },
        });

        expect(report.conflicts[0]).toMatchObject({
            file: 'src/config.ts',
            tier: 2,
            classifierSource: 'path',
        });
        expect(report.conflicts[0].symbolsOverlap).toBeUndefined();
        expect(report.shouldBlock).toBe(false);
    });
});
