const { performance } = require('perf_hooks');

const size = 100000;
const conflicts = Array.from({ length: size }, (_, i) => ({
    tier: i % 4
}));

function oldWay() {
    return {
        tier1: conflicts.filter(c => c.tier === 1).length,
        tier2: conflicts.filter(c => c.tier === 2).length,
        tier3: conflicts.filter(c => c.tier === 3).length,
    };
}

function newWay() {
    let tier1 = 0, tier2 = 0, tier3 = 0;
    for (let i = 0; i < conflicts.length; i++) {
        const tier = conflicts[i].tier;
        if (tier === 1) tier1++;
        else if (tier === 2) tier2++;
        else if (tier === 3) tier3++;
    }
    return { tier1, tier2, tier3 };
}

function runBenchmark(name, fn) {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
        fn();
    }
    const end = performance.now();
    console.log(`${name}: ${(end - start).toFixed(2)}ms`);
}

runBenchmark('oldWay', oldWay);
runBenchmark('newWay', newWay);
