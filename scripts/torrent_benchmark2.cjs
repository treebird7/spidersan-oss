const { performance } = require('perf_hooks');

const taskBranches = Array.from({ length: 100000 }, (_, i) => ({
    status: Math.random() > 0.5 ? 'completed' : 'active'
}));

const roots = Array.from({ length: 20000 }, (_, i) => ({
    children: Array.from({ length: Math.floor(Math.random() * 3) }, () => ({}))
}));
const total = taskBranches.length;

function before() {
    const completed = taskBranches.filter(b => b.status === 'completed').length;
    const active = taskBranches.filter(b => b.status === 'active').length;
    const parents = roots.length;
    const children = total - roots.filter(r => r.children.length === 0).length;
    return { completed, active, parents, children };
}

function after() {
    let completed = 0, active = 0;
    for (const b of taskBranches) {
        if (b.status === 'completed') completed++;
        else if (b.status === 'active') active++;
    }

    let rootWithoutChildren = 0;
    const parents = roots.length;
    for (const r of roots) {
        if (r.children.length === 0) rootWithoutChildren++;
    }
    const children = total - rootWithoutChildren;

    return { completed, active, parents, children };
}

let start = performance.now();
for (let i = 0; i < 100; i++) before();
const timeBefore = performance.now() - start;

start = performance.now();
for (let i = 0; i < 100; i++) after();
const timeAfter = performance.now() - start;

console.log(`Before: ${timeBefore.toFixed(2)}ms`);
console.log(`After:  ${timeAfter.toFixed(2)}ms`);
console.log(`Speedup: ${(timeBefore / timeAfter).toFixed(2)}x`);
