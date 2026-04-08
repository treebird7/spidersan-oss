import { performance } from 'perf_hooks';

function buildConflictGraphOld(branches) {
    const graph = new Map();
    const fileSets = new Map();
    for (const branch of branches) {
        fileSets.set(branch.name, new Set(branch.files));
    }
    for (const branch of branches) {
        const conflicts = [];
        for (const other of branches) {
            if (branch.name === other.name) continue;
            const otherFilesSet = fileSets.get(other.name);
            const overlap = branch.files.some(f => otherFilesSet.has(f));
            if (overlap) {
                conflicts.push(other.name);
            }
        }
        graph.set(branch.name, conflicts);
    }
    return graph;
}

function buildConflictGraphNew(branches) {
    const graph = new Map();
    for (const branch of branches) {
        graph.set(branch.name, []);
    }

    // Inverted index: file -> branch names
    const fileToBranches = new Map();
    for (const branch of branches) {
        // Need to use unique files per branch so that the same branch isn't added multiple times for the same file
        for (const file of new Set(branch.files)) {
            let b = fileToBranches.get(file);
            if (!b) {
                b = [];
                fileToBranches.set(file, b);
            }
            b.push(branch.name);
        }
    }

    const conflictSets = new Map();
    for (const branch of branches) {
        conflictSets.set(branch.name, new Set());
    }

    for (const branchesModifyingFile of fileToBranches.values()) {
        if (branchesModifyingFile.length > 1) {
            for (let i = 0; i < branchesModifyingFile.length; i++) {
                const b1 = branchesModifyingFile[i];
                for (let j = i + 1; j < branchesModifyingFile.length; j++) {
                    const b2 = branchesModifyingFile[j];
                    conflictSets.get(b1).add(b2);
                    conflictSets.get(b2).add(b1);
                }
            }
        }
    }

    for (const branch of branches) {
        graph.set(branch.name, Array.from(conflictSets.get(branch.name)));
    }

    return graph;
}

// Generate test data
const numBranches = 2000;
const numFilesPerBranch = 50;
const totalUniqueFiles = 10000;
const branches = [];

for (let i = 0; i < numBranches; i++) {
    const files = [];
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
const endOld = performance.now();

const startNew = performance.now();
const newGraph = buildConflictGraphNew(branches);
const endNew = performance.now();

// Verify correctness
let correct = true;
for (const branch of branches) {
    const oldSet = new Set(oldGraph.get(branch.name));
    const newSet = new Set(newGraph.get(branch.name));
    if (oldSet.size !== newSet.size) {
        console.log(`Mismatch on branch ${branch.name}: old size ${oldSet.size}, new size ${newSet.size}`);
        correct = false;
        break;
    }
    for (const val of oldSet) {
        if (!newSet.has(val)) {
            console.log(`Mismatch on branch ${branch.name}: old has ${val}, new does not`);
            correct = false;
            break;
        }
    }
}

console.log(`Correct: ${correct}`);
console.log(`Old: ${(endOld - startOld).toFixed(2)}ms`);
console.log(`New: ${(endNew - startNew).toFixed(2)}ms`);
