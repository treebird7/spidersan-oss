import { performance } from 'perf_hooks';

// Simulate Branch type
function generateBranches(numBranches, filesPerBranch, overlapRate) {
    const branches = [];
    let fileIdCounter = 0;
    for (let i = 0; i < numBranches; i++) {
        const files = [];
        for (let j = 0; j < filesPerBranch; j++) {
            if (Math.random() < overlapRate) {
                // Pick a random existing file to create an overlap
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
    return branches;
}

function buildConflictGraph_Original(branches) {
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

function buildConflictGraph_Optimized(branches) {
    const graph = new Map();

    // Inverted index: file -> branches
    const fileToBranches = new Map();
    for (const branch of branches) {
        graph.set(branch.name, []); // initialize empty conflicts
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
        const conflictSet = new Set();
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

const branches = generateBranches(1000, 50, 0.1);

console.log('Branches:', branches.length);

const startOrg = performance.now();
const orgGraph = buildConflictGraph_Original(branches);
const timeOrg = performance.now() - startOrg;

const startOpt = performance.now();
const optGraph = buildConflictGraph_Optimized(branches);
const timeOpt = performance.now() - startOpt;

console.log(`Original: ${timeOrg.toFixed(2)}ms`);
console.log(`Optimized: ${timeOpt.toFixed(2)}ms`);

// Verify Correctness
let isCorrect = true;
for (const branch of branches) {
    const orgConflicts = orgGraph.get(branch.name).sort();
    const optConflicts = optGraph.get(branch.name).sort();
    if (orgConflicts.join(',') !== optConflicts.join(',')) {
        isCorrect = false;
        console.error(`Mismatch for branch ${branch.name}`);
        break;
    }
}
console.log(`Correct: ${isCorrect}`);
