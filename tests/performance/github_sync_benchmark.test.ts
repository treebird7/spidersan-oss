import { describe, it, expect, vi } from 'vitest';
import * as child_process from 'child_process';
import { getCommitInfo, getCIStatus, getAheadBehind } from '../../src/lib/github.js';

vi.mock('child_process', () => {
    return {
        execFile: vi.fn((cmd, args, options, callback) => {
            setTimeout(() => {
                let result = '{}';
                callback(null, { stdout: result, stderr: '' });
            }, 10);
            return {};
        }),
        execFileSync: vi.fn(() => '{}')
    };
});

describe('GitHub API Concurrency', () => {
    it('executes API calls concurrently', async () => {
        const config = { owner: 'test', repo: 'test' };

        const start = Date.now();
        await Promise.all([
            getCommitInfo(config, 'main'),
            getCIStatus(config, 'main'),
            getAheadBehind(config, 'main')
        ]);
        const end = Date.now();

        // Since each mock takes 10ms, sequential would take ~30ms.
        // Concurrent should take ~10-15ms.
        expect(end - start).toBeLessThan(25);
    });
});
