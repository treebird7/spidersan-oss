import { describe, it, expect, vi } from 'vitest';
import { syncFromColony } from '../../src/lib/colony-subscriber.js';

describe('Colony Conflict Detection Performance', () => {
    it('benchmarks conflict detection with hoisted Set', () => {
        // We can just extract the logic and benchmark it
        const branches = Array.from({ length: 1000 }, (_, i) => ({
            name: `branch-${i}`,
            files: Array.from({ length: 100 }, (_, j) => `file-${i}-${j}.ts`),
            status: 'active'
        }));

        const startBaseline = performance.now();

        let baselineConflicts = 0;
        for (let i = 0; i < branches.length; i++) {
            for (let j = i + 1; j < branches.length; j++) {
                const a = branches[i];
                const b = branches[j];
                const aFiles = new Set(a.files);
                const overlapping = b.files.filter(f => aFiles.has(f));
                if (overlapping.length > 0) {
                    baselineConflicts++;
                }
            }
        }

        const endBaseline = performance.now();
        const baselineTime = endBaseline - startBaseline;

        const startOptimized = performance.now();

        let optimizedConflicts = 0;
        for (let i = 0; i < branches.length; i++) {
            const a = branches[i];
            const aFiles = new Set(a.files);
            for (let j = i + 1; j < branches.length; j++) {
                const b = branches[j];
                const overlapping = b.files.filter(f => aFiles.has(f));
                if (overlapping.length > 0) {
                    optimizedConflicts++;
                }
            }
        }

        const endOptimized = performance.now();
        const optimizedTime = endOptimized - startOptimized;

        console.log(`\n⚡ Colony Conflict Detection Benchmark`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Branches:      ${branches.length}`);
        console.log(`Files/Branch:  100`);
        console.log(`\nSet inside inner loop (Baseline): ${baselineTime.toFixed(2)}ms`);
        console.log(`Hoisted Set (Optimized):          ${optimizedTime.toFixed(2)}ms`);
        console.log(`Speedup:                          ${(baselineTime / optimizedTime).toFixed(1)}x`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

        expect(baselineConflicts).toBe(optimizedConflicts);
    });
});
