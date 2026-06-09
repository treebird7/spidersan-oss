const { performance } = require('perf_hooks');

const checks = Array.from({ length: 100000 }, () => ({
  status: Math.random() > 0.5 ? 'error' : (Math.random() > 0.5 ? 'warn' : 'ok')
}));

function testFilter() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const errors = checks.filter(c => c.status === 'error').length;
    const warnings = checks.filter(c => c.status === 'warn').length;
  }
  const end = performance.now();
  return end - start;
}

function testLoop() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    let errors = 0, warnings = 0;
    for (const c of checks) {
      if (c.status === 'error') errors++;
      else if (c.status === 'warn') warnings++;
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
