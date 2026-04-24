import { describe, it, expect } from 'vitest';

// Simulating Branch
interface Branch {
    name: string;
    files: string[];
}

function buildConflictGraph_Original(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    const fileSets = new Map<string, Set<string>>();
    for (const branch of branches) {
        fileSets.set(branch.name, new Set(branch.files));
    }

    for (const branch of branches) {
        const conflicts: string[] = [];

        for (const other of branches) {
            if (branch.name === other.name) continue;

            const otherFilesSet = fileSets.get(other.name)!;
            const overlap = branch.files.some(f => otherFilesSet.has(f));
            if (overlap) {
                conflicts.push(other.name);
            }
        }

        graph.set(branch.name, conflicts);
    }

    return graph;
}

function buildConflictGraph_Optimized(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    const fileToBranches = new Map<string, string[]>();
    for (const branch of branches) {
        for (const file of branch.files) {
            let list = fileToBranches.get(file);
            if (!list) {
                list = [];
                fileToBranches.set(file, list);
            }
            list.push(branch.name);
        }
    }

    for (const branch of branches) {
        const conflictSet = new Set<string>();

        for (const file of branch.files) {
            const list = fileToBranches.get(file);
            if (list) {
                for (let i = 0; i < list.length; i++) {
                    const otherBranch = list[i];
                    if (otherBranch !== branch.name) {
                        conflictSet.add(otherBranch);
                    }
                }
            }
        }

        graph.set(branch.name, Array.from(conflictSet));
    }

    return graph;
}

describe('Merge Order Conflict Graph Builder Performance', () => {
    it('benchmarks O(N^2 * M) vs O(N * M) logic', () => {
        const numBranches = 1000;
        const filesPerBranch = 50;
        const overlapRate = 0.1;

        const branches: Branch[] = [];
        let fileIdCounter = 0;
        for (let i = 0; i < numBranches; i++) {
            const files: string[] = [];
            for (let j = 0; j < filesPerBranch; j++) {
                if (Math.random() < overlapRate) {
                    files.push(`file_${Math.floor(Math.random() * fileIdCounter)}.ts`);
                } else {
                    files.push(`file_${fileIdCounter++}.ts`);
                }
            }
            branches.push({
                name: `branch_${i}`,
                files: Array.from(new Set(files))
            });
        }

        const startOrg = performance.now();
        const orgGraph = buildConflictGraph_Original(branches);
        const timeOrg = performance.now() - startOrg;

        const startOpt = performance.now();
        const optGraph = buildConflictGraph_Optimized(branches);
        const timeOpt = performance.now() - startOpt;

        console.log(`\n⚡ Conflict Graph Building Benchmark`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Branches:      ${numBranches}`);
        console.log(`Files/Branch:  ${filesPerBranch}`);

        console.log(`Nested Loop (Baseline): ${timeOrg.toFixed(2)}ms`);
        console.log(`Inverted Index (Optimized): ${timeOpt.toFixed(2)}ms`);
        console.log(`Speedup: ${(timeOrg / timeOpt).toFixed(1)}x\n`);

        expect(timeOpt).toBeLessThan(timeOrg);

        for (const branch of branches) {
            const orgConflicts = orgGraph.get(branch.name)!.sort();
            const optConflicts = optGraph.get(branch.name)!.sort();
            expect(orgConflicts.join(',')).toBe(optConflicts.join(','));
        }
    });
});
