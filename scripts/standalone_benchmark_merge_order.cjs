const { performance } = require('perf_hooks');

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

    const fileToBranches = new Map();
    for (const branch of branches) {
        for (const file of branch.files) {
            let bList = fileToBranches.get(file);
            if (!bList) {
                bList = [];
                fileToBranches.set(file, bList);
            }
            bList.push(branch.name);
        }
    }

    for (const branch of branches) {
        const conflicts = new Set();
        for (const file of branch.files) {
            const overlappingBranches = fileToBranches.get(file);
            if (overlappingBranches) {
                for (const otherBranch of overlappingBranches) {
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

// Generate test data
const branches = [];
const numBranches = 1000;
const numFilesPerBranch = 50;
const totalFiles = 5000;

for (let i = 0; i < numBranches; i++) {
    const files = [];
    for (let j = 0; j < numFilesPerBranch; j++) {
        // Random file out of totalFiles
        files.push(`src/file_${Math.floor(Math.random() * totalFiles)}.ts`);
    }
    branches.push({ name: `branch_${i}`, files });
}

console.log("Warming up...");
buildConflictGraphOld(branches);
buildConflictGraphNew(branches);

console.log("Benchmarking Old (O(N^2 * M))...");
const t0 = performance.now();
buildConflictGraphOld(branches);
const t1 = performance.now();
console.log(`Old took ${t1 - t0} ms`);

console.log("Benchmarking New (O(N * M))...");
const t2 = performance.now();
buildConflictGraphNew(branches);
const t3 = performance.now();
console.log(`New took ${t3 - t2} ms`);
