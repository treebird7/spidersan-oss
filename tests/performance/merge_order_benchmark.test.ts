import { describe, it, expect } from 'vitest';

describe('Merge Order Performance', () => {
    it('benchmarks conflict graph building and topological sort', () => {
        // Setup
        const numBranches = 200;
        const filesPerBranch = 50;

        // Generate other branches with some overlapping files
        const branches = Array.from({ length: numBranches }, (_, i) => ({
            name: `branch-${i}`,
            files: Array.from({ length: filesPerBranch }, (_, j) => `src/components/comp-${(j * 10) + (i % 50)}.ts`),
            registeredAt: new Date(Date.now() - i * 1000),
            status: 'active' as const
        }));

        // Baseline (Set.has approach - O(N^2 * M))
        function buildConflictGraphBaseline(branches: any[]) {
            const graph = new Map<string, string[]>();

            // Convert to sets for O(1) lookup
            const fileSets = new Map<string, Set<string>>();
            for (const branch of branches) {
                fileSets.set(branch.name, new Set(branch.files));
            }

            for (const branch of branches) {
                const conflicts: string[] = [];
                for (const other of branches) {
                    if (branch.name === other.name) continue;
                    const otherFilesSet = fileSets.get(other.name)!;
                    const overlap = branch.files.some((f: string) => otherFilesSet.has(f));
                    if (overlap) {
                        conflicts.push(other.name);
                    }
                }
                graph.set(branch.name, conflicts);
            }
            return graph;
        }

        const startBaseline = performance.now();
        const graphBaseline = buildConflictGraphBaseline(branches);
        const timeBaseline = performance.now() - startBaseline;

        // Optimized (Map of file -> branches approach - O(N * M))
        function buildConflictGraphOptimized(branches: any[]) {
            const graph = new Map<string, string[]>();
            const fileToBranches = new Map<string, string[]>();

            for (const branch of branches) {
                for (const file of branch.files) {
                    if (!fileToBranches.has(file)) {
                        fileToBranches.set(file, []);
                    }
                    fileToBranches.get(file)!.push(branch.name);
                }
            }

            for (const branch of branches) {
                const conflicts = new Set<string>();
                for (const file of branch.files) {
                    const branchesWithFile = fileToBranches.get(file);
                    if (branchesWithFile) {
                        for (const otherBranch of branchesWithFile) {
                            if (otherBranch !== branch.name) {
                                conflicts.add(otherBranch);
                            }
                        }
                    }
                }
                graph.set(branch.name, Array.from(conflicts));
            }

            return graph;
        }

        const startOptimized = performance.now();
        const graphOptimized = buildConflictGraphOptimized(branches);
        const timeOptimized = performance.now() - startOptimized;

        console.log(`
⚡ Merge Order Conflict Graph Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branches:      ${numBranches}
Files/Branch:  ${filesPerBranch}

Set.has Loop (Baseline): ${timeBaseline.toFixed(2)}ms
Inverted Index (Optimized):       ${timeOptimized.toFixed(2)}ms
Speedup:                   ${(timeBaseline / timeOptimized).toFixed(1)}x
        `);

        // Verify outputs match
        expect(Array.from(graphOptimized.keys())).toEqual(Array.from(graphBaseline.keys()));
        for (const [key, value] of graphOptimized.entries()) {
            // Because maps and sets order might be slightly different depending on iteration
            // We sort the values (which are arrays of strings)
            const sortedVal = [...value].sort();
            const sortedBaseline = [...(graphBaseline.get(key) || [])].sort();
            expect(sortedVal).toEqual(sortedBaseline);
        }
        expect(timeOptimized).toBeLessThan(timeBaseline);
    });
});
