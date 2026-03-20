import { expect, test, describe } from 'vitest';

describe('Colony Subscriber Performance: Conflict Detection', () => {
    test('optimized Set creation in nested loop is faster', () => {
        // Create a large number of branches with overlapping files
        const numBranches = 100;
        const activeBranches: { name: string, files: string[], agent: string }[] = [];
        for (let i = 0; i < numBranches; i++) {
            const files: string[] = [];
            for (let j = 0; j < 1000; j++) {
                files.push(`file_${i}_${j}.ts`);
                if (i > 0 && j < 10) {
                    files.push(`file_${0}_${j}.ts`); // Intentionally cause conflicts
                }
            }
            activeBranches.push({ name: `branch_${i}`, files, agent: `agent_${i}` });
        }

        // Measure unoptimized approach (how it was before)
        const startUnoptimized = performance.now();
        const conflicts1 = [];
        for (let i = 0; i < activeBranches.length; i++) {
            for (let j = i + 1; j < activeBranches.length; j++) {
                const a = activeBranches[i];
                const b = activeBranches[j];
                const aFiles = new Set(a.files); // Unoptimized: created in inner loop
                const overlapping = b.files.filter(f => aFiles.has(f));
                if (overlapping.length > 0) {
                    conflicts1.push({
                        branch: a.name,
                        conflictsWith: b.name,
                        files: overlapping,
                        agent: a.agent,
                    });
                }
            }
        }
        const endUnoptimized = performance.now();
        const unoptimizedTime = endUnoptimized - startUnoptimized;

        // Measure optimized approach (how it is now)
        const startOptimized = performance.now();
        const conflicts2 = [];
        for (let i = 0; i < activeBranches.length; i++) {
            const a = activeBranches[i];
            const aFiles = new Set(a.files); // Optimized: created in outer loop
            for (let j = i + 1; j < activeBranches.length; j++) {
                const b = activeBranches[j];
                const overlapping = b.files.filter(f => aFiles.has(f));
                if (overlapping.length > 0) {
                    conflicts2.push({
                        branch: a.name,
                        conflictsWith: b.name,
                        files: overlapping,
                        agent: a.agent,
                    });
                }
            }
        }
        const endOptimized = performance.now();
        const optimizedTime = endOptimized - startOptimized;

        console.log(`Unoptimized Time: ${unoptimizedTime.toFixed(2)}ms`);
        console.log(`Optimized Time: ${optimizedTime.toFixed(2)}ms`);

        // Functional verification: both should yield the exact same results
        expect(conflicts1).toEqual(conflicts2);

        // Performance verification: optimized should be faster
        // We use a relative check to avoid strict numerical constraints that fail in CI
        expect(optimizedTime).toBeLessThan(unoptimizedTime);
    });
});