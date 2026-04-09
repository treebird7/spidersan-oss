import { describe, it, expect } from 'vitest';
import { mergeOrderCommand } from '../../src/commands/merge-order.js';

// Extracting just the testing logic
function buildConflictGraphOld(branches: { name: string, files: string[] }[]): Map<string, string[]> {
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

function buildConflictGraphNew(branches: { name: string, files: string[] }[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();
    const fileToBranches = new Map<string, string[]>();
    const conflictSets = new Map<string, Set<string>>();

    for (const branch of branches) {
        conflictSets.set(branch.name, new Set<string>());
        const uniqueFiles = new Set(branch.files);
        for (const file of uniqueFiles) {
            let branchList = fileToBranches.get(file);
            if (!branchList) {
                branchList = [];
                fileToBranches.set(file, branchList);
            }
            branchList.push(branch.name);
        }
    }

    for (const branchList of fileToBranches.values()) {
        if (branchList.length > 1) {
            for (let i = 0; i < branchList.length; i++) {
                const b1 = branchList[i]!;
                const set1 = conflictSets.get(b1)!;
                for (let j = i + 1; j < branchList.length; j++) {
                    const b2 = branchList[j]!;
                    set1.add(b2);
                    conflictSets.get(b2)!.add(b1);
                }
            }
        }
    }

    for (const [branch, conflicts] of conflictSets.entries()) {
        graph.set(branch, Array.from(conflicts));
    }

    return graph;
}

describe('Merge Order Performance', () => {
    it('benchmarks nested loops vs inverted index for buildConflictGraph', () => {
        // Generate test data
        const numBranches = 1000;
        const filesPerBranch = 100;
        const totalFiles = 2000;

        const branches = [];
        for (let i = 0; i < numBranches; i++) {
            const files = [];
            for (let j = 0; j < filesPerBranch; j++) {
                const fileId = Math.floor(Math.random() * totalFiles);
                files.push(`file_${fileId}.ts`);
            }
            branches.push({ name: `branch_${i}`, files });
        }

        // Run Baseline (Old)
        const startOld = performance.now();
        const oldResult = buildConflictGraphOld(branches);
        const endOld = performance.now();
        const timeOld = endOld - startOld;

        // Run Optimized (New)
        const startNew = performance.now();
        const newResult = buildConflictGraphNew(branches);
        const endNew = performance.now();
        const timeNew = endNew - startNew;

        console.log(`\n⚡ Merge Order Conflict Graph Benchmark`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`Branches:      ${numBranches}`);
        console.log(`Files/Branch:  ${filesPerBranch}`);
        console.log(`Target Files:  ${totalFiles}\n`);

        console.log(`Nested Loops (Baseline): ${timeOld.toFixed(2)}ms`);
        console.log(`Inverted Index (Optimized): ${timeNew.toFixed(2)}ms`);

        const speedup = timeOld / timeNew;
        console.log(`Speedup:               ${speedup.toFixed(1)}x\n`);

        // Ensure accuracy
        expect(oldResult.size).toBe(newResult.size);
        for(let [branch, conflicts] of oldResult) {
            const newConflicts = newResult.get(branch);
            expect(newConflicts).toBeDefined();
            // Both arrays should contain the same items (order independent)
            expect(conflicts.sort()).toEqual(newConflicts!.sort());
        }
    });
});
