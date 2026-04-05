import { describe, it, expect } from 'vitest';

interface Branch {
    name: string;
    files: string[];
    registeredAt: string;
}

function buildConflictGraphOld(branches: Branch[]): Map<string, string[]> {
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

function buildConflictGraphNew(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    // Optimization: Inverted index
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
            const overlappingBranches = fileToBranches.get(file);
            if (overlappingBranches) {
                for (const otherBranch of overlappingBranches) {
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

describe('merge order build conflict graph', () => {
    // Increase timeout since the baseline O(N^2 * M) implementation takes ~10 seconds
    it('should improve performance significantly', () => {
        // Generate mock data
        const branches: Branch[] = [];
        const numBranches = 5000;
        const numFilesPerBranch = 10;
        const numTotalFiles = 500;

        for (let i = 0; i < numBranches; i++) {
            const files = [];
            for (let j = 0; j < numFilesPerBranch; j++) {
                files.push(`src/file_${Math.floor(Math.random() * numTotalFiles)}.ts`);
            }
            branches.push({
                name: `branch_${i}`,
                files,
                registeredAt: new Date().toISOString()
            });
        }

        const startOld = performance.now();
        const oldResult = buildConflictGraphOld(branches);
        const endOld = performance.now();
        console.log(`Old Implementation: ${(endOld - startOld).toFixed(2)}ms`);

        const startNew = performance.now();
        const newResult = buildConflictGraphNew(branches);
        const endNew = performance.now();
        console.log(`New Implementation: ${(endNew - startNew).toFixed(2)}ms`);

        // Check correctness
        expect(newResult.size).toBe(oldResult.size);
        for (const [branch, conflicts] of oldResult.entries()) {
            const newConflicts = newResult.get(branch) || [];
            expect(new Set(newConflicts)).toEqual(new Set(conflicts));
        }
    }, 20000); // Set timeout as the 3rd argument for Vitest compatibility
});
