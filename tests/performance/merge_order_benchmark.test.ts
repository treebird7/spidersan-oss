import { describe, it, expect } from 'vitest';

// We mock the types and logic since we can't easily import the internal function
interface Branch {
  name: string;
  files: string[];
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

    // Inverted index: map files to the branches that touch them
    const fileToBranches = new Map<string, string[]>();

    for (const branch of branches) {
        // Initialize graph for this branch
        graph.set(branch.name, []);

        for (const file of branch.files) {
            let branchesWithFile = fileToBranches.get(file);
            if (!branchesWithFile) {
                branchesWithFile = [];
                fileToBranches.set(file, branchesWithFile);
            }
            branchesWithFile.push(branch.name);
        }
    }

    // Now populate conflicts using the inverted index
    for (const branch of branches) {
        const conflictSet = new Set<string>();

        for (const file of branch.files) {
            const others = fileToBranches.get(file);
            if (others) {
                for (const other of others) {
                    if (other !== branch.name) {
                        conflictSet.add(other);
                    }
                }
            }
        }

        graph.set(branch.name, Array.from(conflictSet));
    }

    return graph;
}

describe('Merge Order Conflict Graph Building', () => {
  it('should be significantly faster using an inverted index', () => {
    // Generate test data
    const branches: Branch[] = [];
    const NUM_BRANCHES = 1000;
    const FILES_PER_BRANCH = 50;
    const TOTAL_UNIQUE_FILES = 2000;

    for (let i = 0; i < NUM_BRANCHES; i++) {
      branches.push({
        name: `branch-${i}`,
        files: Array.from({ length: FILES_PER_BRANCH }, (_, j) => `file-${(i * 10 + j) % TOTAL_UNIQUE_FILES}.ts`)
      });
    }

    const startOld = performance.now();
    const resultOld = buildConflictGraphOld(branches);
    const endOld = performance.now();

    const startNew = performance.now();
    const resultNew = buildConflictGraphNew(branches);
    const endNew = performance.now();

    const timeOld = endOld - startOld;
    const timeNew = endNew - startNew;
    const speedup = timeOld / timeNew;

    console.log(`\n⚡ Merge Order Conflict Graph Benchmark`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Branches:      ${NUM_BRANCHES}`);
    console.log(`Files/Branch:  ${FILES_PER_BRANCH}`);
    console.log(`Target Files:  ${TOTAL_UNIQUE_FILES}\n`);

    console.log(`Nested Loop (Baseline): ${timeOld.toFixed(2)}ms`);
    console.log(`Inverted Index (Optimized): ${timeNew.toFixed(2)}ms`);
    console.log(`Speedup:               ${speedup.toFixed(1)}x\n`);

    // Verify correctness
    for (const branch of branches) {
        const oldConflicts = resultOld.get(branch.name) || [];
        const newConflicts = resultNew.get(branch.name) || [];
        expect(newConflicts.sort()).toEqual(oldConflicts.sort());
    }

    // Ensure it's faster
    expect(timeNew).toBeLessThan(timeOld);
  });
});
