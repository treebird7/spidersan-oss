import { describe, it, expect } from 'vitest';

describe('Conflict Detection Performance', () => {
    it('benchmarks array vs set lookup for conflict detection', () => {
        // Setup
        const numBranches = 1000;
        const filesPerBranch = 100;
        const targetFilesCount = 1000;

        // Generate target files
        const targetFiles = Array.from({ length: targetFilesCount }, (_, i) => `src/components/comp-${i}.ts`);

        // Generate other branches with some overlapping files
        const branches = Array.from({ length: numBranches }, (_, i) => ({
            name: `branch-${i}`,
            // Create some overlap by using modulo arithmetic
            files: Array.from({ length: filesPerBranch }, (_, j) => `src/components/comp-${(j * 10) + (i % 50)}.ts`),
            status: 'active'
        }));

        // Measure Array.includes (Current Implementation)
        const startArray = performance.now();
        let conflictsArray = 0;
        for (const branch of branches) {
            const overlapping = branch.files.filter(f => targetFiles.includes(f));
            if (overlapping.length > 0) conflictsArray++;
        }
        const endArray = performance.now();
        const timeArray = endArray - startArray;

        // Measure Set.has (Optimized Implementation)
        const startSetSetup = performance.now();
        const targetSet = new Set(targetFiles);
        const startSetLoop = performance.now();
        let conflictsSet = 0;
        for (const branch of branches) {
            const overlapping = branch.files.filter(f => targetSet.has(f));
            if (overlapping.length > 0) conflictsSet++;
        }
        const endSet = performance.now();
        const timeSetTotal = endSet - startSetSetup; // Include Set creation time for fair comparison

        console.log(`
⚡ Conflict Detection Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branches:      ${numBranches}
Files/Branch:  ${filesPerBranch}
Target Files:  ${targetFilesCount}

Array.includes (Baseline): ${timeArray.toFixed(2)}ms
Set.has (Optimized):       ${timeSetTotal.toFixed(2)}ms
Speedup:                   ${(timeArray / timeSetTotal).toFixed(1)}x
        `);

        expect(conflictsSet).toBe(conflictsArray);
        // We expect at least 2x speedup, but usually it's much more
        expect(timeSetTotal).toBeLessThan(timeArray);
    });
});
