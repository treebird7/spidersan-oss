import { describe, it, expect } from 'vitest';

const TIER_3_PATTERNS = [
    /\.env$/,
    /secrets?\./i,
    /credentials/i,
    /password/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /\.pem$/,
    /auth\.(ts|js)$/,
    /security\.(ts|js)$/,
];

describe('Conflict Tier Detection Performance', () => {
    it('benchmarks loop vs consolidated RegExp', () => {
        const numFiles = 10000;
        const files = Array.from({ length: numFiles }, (_, i) => `src/components/comp-${i}.ts`);
        files.push('src/auth.ts', '.env', 'config/secrets.json');

        const extraPatterns = [/^src\/important/, /\.key$/];

        // Old implementation
        const startOld = performance.now();
        let oldMatches = 0;
        for (const file of files) {
            const tier3 = [...TIER_3_PATTERNS, ...extraPatterns];
            for (const pattern of tier3) {
                if (pattern.test(file)) {
                    oldMatches++;
                    break;
                }
            }
        }
        const timeOld = performance.now() - startOld;

        // New implementation: Consolidated RegExp
        const startNewSetup = performance.now();
        const combined = new RegExp(
            [...TIER_3_PATTERNS, ...extraPatterns].map(p => p.source).join('|'),
            'i'
        );
        let newMatches = 0;
        for (const file of files) {
            if (combined.test(file)) {
                newMatches++;
            }
        }
        const timeNew = performance.now() - startNewSetup;

        console.log(`
⚡ Tier Pattern Matching Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files:         ${numFiles + 3}
Patterns:      ${TIER_3_PATTERNS.length + extraPatterns.length}

Loop over Regex array (Baseline): ${timeOld.toFixed(2)}ms
Consolidated RegExp (Optimized):  ${timeNew.toFixed(2)}ms
Speedup:                          ${(timeOld / timeNew).toFixed(1)}x
        `);

        expect(newMatches).toBe(oldMatches);
        expect(timeNew).toBeLessThan(timeOld);
    });
});
