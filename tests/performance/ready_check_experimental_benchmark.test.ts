import { describe, it, expect } from 'vitest';

describe('Ready Check Experimental Pattern Benchmark', () => {
    it('benchmarks consolidated RegExp pre-filter vs nested loops', () => {
        const numFiles = 10000;
        const numPatterns = 50;

        // Generate files
        const changedFiles = Array.from({ length: numFiles }, (_, i) => `src/components/feature-${i}/index.ts`);
        // Add some matches
        changedFiles.push('src/experimental/test.ts');
        changedFiles.push('src/test-feature/index.ts');

        // Generate patterns
        const experimentalPatterns = Array.from({ length: numPatterns }, (_, i) => `pattern-${i}-`);
        experimentalPatterns.push('experimental/');
        experimentalPatterns.push('test-');

        // Measure Baseline (Nested loops)
        const startBaseline = performance.now();
        let issuesBaseline = 0;
        for (const file of changedFiles) {
            for (const pattern of experimentalPatterns) {
                if (file.includes(pattern)) {
                    issuesBaseline++;
                }
            }
        }
        const endBaseline = performance.now();
        const timeBaseline = endBaseline - startBaseline;

        // Measure Optimized (Consolidated RegExp pre-filter)
        const startOptimized = performance.now();
        let issuesOptimized = 0;

        // Hoisted pre-filter
        if (experimentalPatterns.length > 0) {
            const escapedPatterns = experimentalPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            const consolidatedRegex = new RegExp(escapedPatterns.join('|'));

            for (const file of changedFiles) {
                if (consolidatedRegex.test(file)) {
                    for (const pattern of experimentalPatterns) {
                        if (file.includes(pattern)) {
                            issuesOptimized++;
                        }
                    }
                }
            }
        }

        const endOptimized = performance.now();
        const timeOptimized = endOptimized - startOptimized;

        console.log(`
⚡ Ready Check Experimental Pattern Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files:    ${numFiles}
Patterns: ${numPatterns}

Nested loops (Baseline):        ${timeBaseline.toFixed(2)}ms
Consolidated RegExp (Optimized): ${timeOptimized.toFixed(2)}ms
Speedup:                        ${(timeBaseline / timeOptimized).toFixed(1)}x
        `);

        expect(issuesOptimized).toBe(issuesBaseline);
        expect(timeOptimized).toBeLessThan(timeBaseline);
    });
});
