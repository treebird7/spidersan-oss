import { minimatch, Minimatch } from 'minimatch';

const files = Array.from({length: 1000}, (_, i) => `src/components/button${i}.tsx`);
files.push('package-lock.json', 'node_modules/foo/bar.js', 'dist/index.js');
const patterns = ['**/package-lock.json', '**/node_modules/**', 'dist/**'];

console.time('stateless');
for (let i = 0; i < 100; i++) {
  for (const file of files) {
    patterns.some(pattern => minimatch(file, pattern));
  }
}
console.timeEnd('stateless');

console.time('compiled');
const compiled = patterns.map(p => new Minimatch(p));
for (let i = 0; i < 100; i++) {
  for (const file of files) {
    compiled.some(m => m.match(file));
  }
}
console.timeEnd('compiled');
