import { describe, it, expect } from 'vitest';

// Minimal Branch type to make test compile
interface Branch {
    name: string;
    files: string[];
    status: string;
    registeredAt: Date | string;
    taskId?: string;
}

function buildConflictGraphOriginal(branches: Branch[]): Map<string, string[]> {
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

function buildConflictGraphOptimized(branches: Branch[]): Map<string, string[]> {
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
        const conflicts = new Set<string>();
        for (const file of branch.files) {
            const list = fileToBranches.get(file)!;
            for (let i = 0; i < list.length; i++) {
                const other = list[i];
                if (other !== branch.name) {
                    conflicts.add(other);
                }
            }
        }
        graph.set(branch.name, Array.from(conflicts));
    }
    return graph;
}

describe('Merge Order Conflict Graph Performance', () => {
    it('benchmarks nested loop vs inverted index', () => {
        const numBranches = 1500;
        const filesPerBranch = 50;

        const branches: Branch[] = Array.from({ length: numBranches }, (_, i) => ({
            name: `branch-${i}`,
            files: Array.from({ length: filesPerBranch }, (_, j) => `src/file-${(j * 10) + (i % 50)}.ts`),
            status: 'active',
            registeredAt: new Date()
        }));

        const startOriginal = performance.now();
        const graphOriginal = buildConflictGraphOriginal(branches);
        const timeOriginal = performance.now() - startOriginal;

        const startOptimized = performance.now();
        const graphOptimized = buildConflictGraphOptimized(branches);
        const timeOptimized = performance.now() - startOptimized;

        console.log(`
⚡ Merge Order Graph Building Benchmark
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Branches:      ${numBranches}
Files/Branch:  ${filesPerBranch}

Nested Loop (Baseline):     ${timeOriginal.toFixed(2)}ms
Inverted Index (Optimized): ${timeOptimized.toFixed(2)}ms
Speedup:                    ${(timeOriginal / timeOptimized).toFixed(1)}x
        `);

        // Assert correctness
        for (const branch of branches) {
            const orig = graphOriginal.get(branch.name) || [];
            const opt = graphOptimized.get(branch.name) || [];
            expect(opt.sort()).toEqual(orig.sort());
        }

        expect(timeOptimized).toBeLessThan(timeOriginal);
    });
});
