import { describe, it, expect } from 'vitest';
import { performance } from 'perf_hooks';

interface Branch {
    name: string;
    files: string[];
    registeredAt: string;
}

// Old O(N^2 * M) implementation
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

// New inverted index implementation
function buildConflictGraphNew(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const conflictSets = new Map<string, Set<string>>();
    const fileToBranches = new Map<string, string[]>();

    // Initialize data structures
    for (const branch of branches) {
        conflictSets.set(branch.name, new Set<string>());
        // Use Set to ensure unique files per branch
        for (const file of new Set(branch.files)) {
            let b = fileToBranches.get(file);
            if (!b) {
                b = [];
                fileToBranches.set(file, b);
            }
            b.push(branch.name);
        }
    }

    // Build conflicts using inverted index
    for (const branchesModifyingFile of fileToBranches.values()) {
        if (branchesModifyingFile.length > 1) {
            for (let i = 0; i < branchesModifyingFile.length; i++) {
                const b1 = branchesModifyingFile[i];
                for (let j = i + 1; j < branchesModifyingFile.length; j++) {
                    const b2 = branchesModifyingFile[j];
                    conflictSets.get(b1)!.add(b2);
                    conflictSets.get(b2)!.add(b1);
                }
            }
        }
    }

    for (const branch of branches) {
        graph.set(branch.name, Array.from(conflictSets.get(branch.name)!));
    }

    return graph;
}

describe('Merge Order Conflict Graph Optimization', () => {
    it('should be significantly faster with inverted index approach', () => {
        // Generate a large number of branches
        const numBranches = 2000;
        const numFilesPerBranch = 50;
        const totalUniqueFiles = 10000;
        const branches: Branch[] = [];

        for (let i = 0; i < numBranches; i++) {
            const files: string[] = [];
            for (let j = 0; j < numFilesPerBranch; j++) {
                // Random file out of total
                const fileId = Math.floor(Math.random() * totalUniqueFiles);
                files.push(`src/file_${fileId}.ts`);
            }
            branches.push({
                name: `branch_${i}`,
                files,
                registeredAt: new Date().toISOString()
            });
        }

        const startOld = performance.now();
        const oldGraph = buildConflictGraphOld(branches);
        const timeOld = performance.now() - startOld;

        const startNew = performance.now();
        const newGraph = buildConflictGraphNew(branches);
        const timeNew = performance.now() - startNew;

        console.log(`Old time: ${timeOld.toFixed(2)}ms`);
        console.log(`New time: ${timeNew.toFixed(2)}ms`);

        // Verify correctness
        for (const branch of branches) {
            const oldSet = new Set(oldGraph.get(branch.name));
            const newSet = new Set(newGraph.get(branch.name));
            expect(oldSet.size).toBe(newSet.size);
            for (const val of oldSet) {
                expect(newSet.has(val)).toBe(true);
            }
        }

        // New approach should be at least 5x faster
        expect(timeNew * 5).toBeLessThan(timeOld);
    });
});
