import { describe, it, expect } from 'vitest';

// Simulating Branch
interface Branch {
    name: string;
    files: string[];
    registeredAt: string;
}

// Old version
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

// New version
function buildConflictGraphNew(branches: Branch[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    // Initialize empty arrays
    for (const branch of branches) {
        graph.set(branch.name, []);
    }

    // Build inverted index (file -> branches that touch it)
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

    // Build conflicts using the inverted index
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

describe('merge order benchmark', () => {
    it('should be functionally equivalent and new one should be faster', () => {
        const branches: Branch[] = [];
        for (let i = 0; i < 1000; i++) {
            branches.push({
                name: `branch-${i}`,
                files: [`file-${i % 50}`, `file-${(i+1) % 50}`, `file-${(i+2) % 50}`],
                registeredAt: '2023-01-01'
            });
        }

        const startOld = performance.now();
        const oldGraph = buildConflictGraphOld(branches);
        const endOld = performance.now();

        const startNew = performance.now();
        const newGraph = buildConflictGraphNew(branches);
        const endNew = performance.now();

        console.log(`Old: ${endOld - startOld}ms`);
        console.log(`New: ${endNew - startNew}ms`);

        for (const branch of branches) {
            const oldConflicts = [...oldGraph.get(branch.name)!].sort();
            const newConflicts = [...newGraph.get(branch.name)!].sort();
            expect(newConflicts).toEqual(oldConflicts);
        }

        expect(endNew - startNew).toBeLessThan(endOld - startOld);
    });
});
