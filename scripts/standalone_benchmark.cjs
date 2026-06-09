const { performance } = require('perf_hooks');

const conflicts = Array.from({ length: 100000 }, () => ({
  tier: Math.floor(Math.random() * 3) + 1
}));

function testFilter() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const tier1 = conflicts.filter(c => c.tier === 1).length;
    const tier2 = conflicts.filter(c => c.tier === 2).length;
    const tier3 = conflicts.filter(c => c.tier === 3).length;
  }
  const end = performance.now();
  return end - start;
}

function testLoop() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    let tier1 = 0, tier2 = 0, tier3 = 0;
    for (const c of conflicts) {
      if (c.tier === 1) tier1++;
      else if (c.tier === 2) tier2++;
      else if (c.tier === 3) tier3++;
    }
  }
  const end = performance.now();
  return end - start;
}

const timeFilter = testFilter();
const timeLoop = testLoop();

console.log(`Filter time: ${timeFilter.toFixed(2)}ms`);
console.log(`Loop time: ${timeLoop.toFixed(2)}ms`);
console.log(`Speedup: ${(timeFilter / timeLoop).toFixed(2)}x`);
