const { performance } = require('perf_hooks');

const remoteRows = Array.from({ length: 100000 }, () => {
    const rand = Math.random();
    let recommendation = '';
    let status = '';
    if (rand < 0.2) recommendation = 'push';
    else if (rand < 0.4) recommendation = 'pull';
    else if (rand < 0.6) recommendation = 'merge needed';
    else if (rand < 0.8) status = 'up-to-date';
    else status = 'no remote tracking';
    return { recommendation, status };
});

function testFilter() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const pushNeeded = remoteRows.filter(row => row.recommendation === 'push').length;
    const pullNeeded = remoteRows.filter(row => row.recommendation === 'pull').length;
    const mergeNeeded = remoteRows.filter(row => row.recommendation === 'merge needed').length;
    const upToDate = remoteRows.filter(row => row.status === 'up-to-date').length;
    const noTracking = remoteRows.filter(row => row.status === 'no remote tracking').length;
  }
  const end = performance.now();
  return end - start;
}

function testLoop() {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    let pushNeeded = 0, pullNeeded = 0, mergeNeeded = 0, upToDate = 0, noTracking = 0;
    for (const row of remoteRows) {
        if (row.recommendation === 'push') pushNeeded++;
        else if (row.recommendation === 'pull') pullNeeded++;
        else if (row.recommendation === 'merge needed') mergeNeeded++;
        else if (row.status === 'up-to-date') upToDate++;
        else if (row.status === 'no remote tracking') noTracking++;
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
