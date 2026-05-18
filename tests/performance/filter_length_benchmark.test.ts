import { describe, it, expect } from 'vitest';

describe('Filter Length Performance', () => {
    it('benchmarks multiple filters vs single loop', () => {
        const items = Array.from({ length: 100000 }, (_, i) => ({
            status: i % 4 === 0 ? 'error' : i % 4 === 1 ? 'warn' : 'ok',
            tier: i % 3 + 1
        }));

        const startBaseline = performance.now();
        for (let i = 0; i < 100; i++) {
            const errors = items.filter(x => x.status === 'error').length;
            const warnings = items.filter(x => x.status === 'warn').length;
            const ok = items.filter(x => x.status === 'ok').length;
            const tier1 = items.filter(x => x.tier === 1).length;
            const tier2 = items.filter(x => x.tier === 2).length;
            const tier3 = items.filter(x => x.tier === 3).length;
        }
        const endBaseline = performance.now();
        const baselineTime = endBaseline - startBaseline;

        const startOptimized = performance.now();
        for (let i = 0; i < 100; i++) {
            let errors = 0, warnings = 0, ok = 0, tier1 = 0, tier2 = 0, tier3 = 0;
            for (const x of items) {
                if (x.status === 'error') errors++;
                else if (x.status === 'warn') warnings++;
                else ok++;

                if (x.tier === 1) tier1++;
                else if (x.tier === 2) tier2++;
                else tier3++;
            }
        }
        const endOptimized = performance.now();
        const optimizedTime = endOptimized - startOptimized;

        console.log(`\n⚡ Filter Length Counting Benchmark`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Items:         ${items.length}`);
        console.log(`Iterations:    100`);
        console.log(`Multiple Filters (Baseline): ${baselineTime.toFixed(2)}ms`);
        console.log(`Single Loop (Optimized):     ${optimizedTime.toFixed(2)}ms`);
        console.log(`Speedup:                     ${(baselineTime / optimizedTime).toFixed(1)}x\n`);

        expect(optimizedTime).toBeLessThan(baselineTime);
    });
});
