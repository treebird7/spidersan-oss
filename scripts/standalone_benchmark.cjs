const { performance } = require('perf_hooks');

const conflicts = Array.from({ length: 100000 }).map((_, i) => ({
    tier: (i % 3) + 1
}));

function summarizeBranchConflictsOld(conflicts) {
    return {
        tier1: conflicts.filter((conflict) => conflict.tier === 1).length,
        tier2: conflicts.filter((conflict) => conflict.tier === 2).length,
        tier3: conflicts.filter((conflict) => conflict.tier === 3).length,
    };
}

function summarizeBranchConflictsNew(conflicts) {
    let tier1 = 0, tier2 = 0, tier3 = 0;
    for (const conflict of conflicts) {
        if (conflict.tier === 1) tier1++;
        else if (conflict.tier === 2) tier2++;
        else if (conflict.tier === 3) tier3++;
    }
    return { tier1, tier2, tier3 };
}

const startOld = performance.now();
for (let i = 0; i < 100; i++) summarizeBranchConflictsOld(conflicts);
const endOld = performance.now();

const startNew = performance.now();
for (let i = 0; i < 100; i++) summarizeBranchConflictsNew(conflicts);
const endNew = performance.now();

console.log(`Old: ${endOld - startOld}ms`);
console.log(`New: ${endNew - startNew}ms`);
console.log(`Speedup: ${(endOld - startOld) / (endNew - startNew)}x`);
