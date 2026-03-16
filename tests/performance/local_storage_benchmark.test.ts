import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalStorage } from '../../src/storage/local.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Local Storage Performance', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = path.join(process.cwd(), '.test-storage-' + Date.now());
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    it('benchmarks array vs set lookup for findByFiles', async () => {
        const storage = new LocalStorage(testDir);
        await storage.init();

        const numBranches = 1000;
        const filesPerBranch = 100;
        const numTargetFiles = 1000;

        console.log('\n⚡ LocalStorage findByFiles Benchmark');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`Branches:      ${numBranches}`);
        console.log(`Files/Branch:  ${filesPerBranch}`);
        console.log(`Target Files:  ${numTargetFiles}\n`);

        for (let i = 0; i < numBranches; i++) {
            const files = Array.from({ length: filesPerBranch }, (_, j) => `src/file_${i}_${j}.ts`);
            await storage.register({
                name: `branch-${i}`,
                files,
                description: 'perf-test',
                agentId: 'perf-agent'
            });
        }

        const targetFiles = Array.from({ length: numTargetFiles }, (_, i) => `src/file_999_${i % 100}.ts`);

        const branches = await storage.list();

        // Baseline (simulated Array.includes)
        const startBaseline = performance.now();
        const resultsBaseline = branches.filter(branch =>
            branch.files.some(file => targetFiles.includes(file))
        );
        const endBaseline = performance.now();
        const timeBaseline = endBaseline - startBaseline;

        // Optimized (actual call, now using Set.has)
        const startOptimized = performance.now();
        const resultsOptimized = await storage.findByFiles(targetFiles);
        const endOptimized = performance.now();
        const timeOptimized = endOptimized - startOptimized;

        const speedup = timeBaseline / timeOptimized;

        console.log(`Array.includes (Baseline): ${timeBaseline.toFixed(2)}ms`);
        console.log(`Set.has (Optimized):       ${timeOptimized.toFixed(2)}ms`);
        console.log(`Speedup:                   ${speedup.toFixed(1)}x\n`);

        expect(resultsOptimized.length).toBe(resultsBaseline.length);
        expect(timeOptimized).toBeLessThan(timeBaseline);
    }, 30000); // give it plenty of time to populate and run
});
