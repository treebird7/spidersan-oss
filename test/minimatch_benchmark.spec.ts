import { describe, it, expect } from 'vitest';
import { minimatch, Minimatch } from 'minimatch';

describe('Minimatch Performance', () => {
    it('benchmarks stateless minimatch vs pre-compiled Minimatch instances', () => {
        const filesCount = 10000;
        const files = Array.from({ length: filesCount }, (_, i) => `src/components/comp-${i}.ts`);
        files.push('node_modules/test/index.js');
        files.push('.git/config');

        const patterns = [
            '**/node_modules/**',
            '**/.git/**',
            '**/dist/**',
            '**/build/**',
            '**/.next/**',
            '**/target/**',
            '**/.turbo/**',
            '**/.cache/**'
        ];

        // Baseline (Stateless Function)
        function shouldExcludeBaseline(file: string): boolean {
            return patterns.some(pattern => minimatch(file, pattern));
        }

        const startBaseline = performance.now();
        let baselineSum = 0;
        for (const file of files) {
            if (shouldExcludeBaseline(file)) baselineSum++;
        }
        const timeBaseline = performance.now() - startBaseline;

        // Optimized (Pre-compiled Instances)
        const compiledPatterns = patterns.map(p => new Minimatch(p));

        function shouldExcludeOptimized(file: string): boolean {
            return compiledPatterns.some(m => m.match(file));
        }

        const startOptimized = performance.now();
        let optimizedSum = 0;
        for (const file of files) {
            if (shouldExcludeOptimized(file)) optimizedSum++;
        }
        const timeOptimized = performance.now() - startOptimized;

        console.log(`
⚡ Minimatch Compilation Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Files Evaluated:  ${filesCount + 2}
Patterns:         ${patterns.length}

Stateless minimatch (Baseline):  ${timeBaseline.toFixed(2)}ms
Compiled Minimatch (Optimized):  ${timeOptimized.toFixed(2)}ms
Speedup:                         ${(timeBaseline / timeOptimized).toFixed(1)}x
        `);

        expect(optimizedSum).toBe(baselineSum);
        // Expect at least 2x speedup
        expect(timeOptimized).toBeLessThan(timeBaseline);
    });
});
