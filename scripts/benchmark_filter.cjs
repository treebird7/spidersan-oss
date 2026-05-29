const { performance } = require('perf_hooks');

const remoteRows = Array.from({ length: 100000 }, (_, i) => ({
    recommendation: ['push', 'pull', 'merge needed', 'none'][i % 4],
    status: ['up-to-date', 'no remote tracking', 'diverged', 'unpushed'][i % 4]
}));

function testFilter() {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
        const pushNeeded = remoteRows.filter(row => row.recommendation === 'push').length;
        const pullNeeded = remoteRows.filter(row => row.recommendation === 'pull').length;
        const mergeNeeded = remoteRows.filter(row => row.recommendation === 'merge needed').length;
        const upToDate = remoteRows.filter(row => row.status === 'up-to-date').length;
        const noTracking = remoteRows.filter(row => row.status === 'no remote tracking').length;
    }
    return performance.now() - start;
}

function testLoop() {
    const start = performance.now();
    for (let i = 0; i < 100; i++) {
        let pushNeeded = 0;
        let pullNeeded = 0;
        let mergeNeeded = 0;
        let upToDate = 0;
        let noTracking = 0;
        for (const row of remoteRows) {
            if (row.recommendation === 'push') pushNeeded++;
            if (row.recommendation === 'pull') pullNeeded++;
            if (row.recommendation === 'merge needed') mergeNeeded++;
            if (row.status === 'up-to-date') upToDate++;
            if (row.status === 'no remote tracking') noTracking++;
        }
    }
    return performance.now() - start;
}

console.log('Filter:', testFilter(), 'ms');
console.log('Loop:', testLoop(), 'ms');
