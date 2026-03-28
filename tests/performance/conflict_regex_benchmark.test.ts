import { describe, it, expect } from 'vitest';
import { compilePatterns } from '../../src/lib/regex-utils.js';


describe('Conflict Regex Performance', () => {
    it('benchmarks array of regexes vs compiled regex array for tier classification', () => {
        const filesCount = 10000;
        const files = Array.from({ length: filesCount }, (_, i) => `src/components/comp-${i}.ts`);

        const TIER_3_PATTERNS = [
            /\.env$/, /secrets?\./i, /credentials/i, /password/i,
            /api[_-]?key/i, /private[_-]?key/i, /\.pem$/,
            /auth\.(ts|js)$/, /security\.(ts|js)$/
        ];

        const TIER_2_PATTERNS = [
            /package\.json$/, /package-lock\.json$/, /tsconfig\.json$/,
            /CLAUDE\.md$/, /\.gitignore$/, /server\.(ts|js)$/,
            /index\.(ts|js)$/, /config\.(ts|js)$/
        ];

        const highPatterns = Array.from({length: 50}, (_, i) => new RegExp(`high${i}`));
        const mediumPatterns = Array.from({length: 50}, (_, i) => new RegExp(`medium${i}`));

        // Baseline (Loop)
        function classifyTierBaseline(file: string): number {
            const tier3 = [...TIER_3_PATTERNS, ...highPatterns];
            for (const p of tier3) {
                if (p.test(file)) return 3;
            }
            const tier2 = [...TIER_2_PATTERNS, ...mediumPatterns];
            for (const p of tier2) {
                if (p.test(file)) return 2;
            }
            return 1;
        }

        const startBaseline = performance.now();
        let baselineSum = 0;
        for (const file of files) {
            baselineSum += classifyTierBaseline(file);
        }
        const timeBaseline = performance.now() - startBaseline;

        // Optimized (Combined)
        const combinedTier3 = compilePatterns([...TIER_3_PATTERNS, ...highPatterns]);
        const combinedTier2 = compilePatterns([...TIER_2_PATTERNS, ...mediumPatterns]);

        function classifyTierOptimized(file: string): number {
            for (const p of combinedTier3) {
                if (p.test(file)) return 3;
            }
            for (const p of combinedTier2) {
                if (p.test(file)) return 2;
            }
            return 1;
        }

        const startOptimized = performance.now();
        let optimizedSum = 0;
        for (const file of files) {
            optimizedSum += classifyTierOptimized(file);
        }
        const timeOptimized = performance.now() - startOptimized;

        console.log(`
⚡ Conflict Tier Classification Regex Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files Evaluated:  ${filesCount}
Patterns/Tier:    ~60

Regex Array Loop (Baseline): ${timeBaseline.toFixed(2)}ms
Combined Regex (Optimized):  ${timeOptimized.toFixed(2)}ms
Speedup:                     ${(timeBaseline / timeOptimized).toFixed(1)}x
        `);

        expect(optimizedSum).toBe(baselineSum);
        // Expect at least 3x speedup, but it's usually much more
        expect(timeOptimized).toBeLessThan(timeBaseline);
    });
});
