const iterations = 10000;
const arraySize = 5000;

const testData = [];
const statuses = ['error', 'warn', 'ok', 'info', 'debug'];
for (let i = 0; i < arraySize; i++) {
    testData.push({ status: statuses[i % statuses.length], value: i });
}

console.log(`Benchmarking array counting over ${iterations} iterations with array size ${arraySize}...`);

// Baseline: Multiple filters
const start1 = performance.now();
for (let i = 0; i < iterations; i++) {
    const errors = testData.filter(x => x.status === 'error').length;
    const warnings = testData.filter(x => x.status === 'warn').length;
    const ok = testData.filter(x => x.status === 'ok').length;
    // prevent optimization
    if (errors === -1) console.log(errors);
}
const end1 = performance.now();
console.log(`Baseline (multiple filters): ${(end1 - start1).toFixed(2)}ms`);

// Optimized: Single loop
const start2 = performance.now();
for (let i = 0; i < iterations; i++) {
    let errors = 0;
    let warnings = 0;
    let ok = 0;
    for (const item of testData) {
        if (item.status === 'error') errors++;
        else if (item.status === 'warn') warnings++;
        else if (item.status === 'ok') ok++;
    }
    // prevent optimization
    if (errors === -1) console.log(errors);
}
const end2 = performance.now();
console.log(`Optimized (single loop): ${(end2 - start2).toFixed(2)}ms`);
console.log(`Speedup: ${((end1 - start1) / (end2 - start2)).toFixed(2)}x`);
