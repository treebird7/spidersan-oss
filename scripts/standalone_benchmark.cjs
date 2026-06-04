const { performance } = require('perf_hooks');

const items = Array.from({ length: 100000 }, (_, i) => ({ tier: (i % 3) + 1 }));

function method1() {
  const tier1 = items.filter(c => c.tier === 1).length;
  const tier2 = items.filter(c => c.tier === 2).length;
  const tier3 = items.filter(c => c.tier === 3).length;
  return [tier1, tier2, tier3];
}

function method2() {
  let tier1 = 0, tier2 = 0, tier3 = 0;
  for (const c of items) {
    if (c.tier === 1) tier1++;
    else if (c.tier === 2) tier2++;
    else if (c.tier === 3) tier3++;
  }
  return [tier1, tier2, tier3];
}

// Warmup
for (let i = 0; i < 100; i++) { method1(); method2(); }

const runs = 100;
let t1 = performance.now();
for (let i = 0; i < runs; i++) method1();
const t2 = performance.now();

let t3 = performance.now();
for (let i = 0; i < runs; i++) method2();
const t4 = performance.now();

console.log('Array.filter: ', t2 - t1, 'ms');
console.log('For loop: ', t4 - t3, 'ms');
