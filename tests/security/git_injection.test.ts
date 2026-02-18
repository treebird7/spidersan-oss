
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitMessagesAdapter } from '../../src/storage/git-messages.js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';

// Mock child_process and fs
vi.mock('child_process', () => ({
    execFileSync: vi.fn(),
    spawnSync: vi.fn(() => ({ status: 0, stdout: '' }))
}));
vi.mock('fs');

describe('GitMessagesAdapter Security', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should use execFileSync to prevent command injection when switching branches', async () => {
        const adapter = new GitMessagesAdapter('test-repo');

        // Setup mock behavior for execFileSync
        (execFileSync as any).mockImplementation((cmd: string, args: string[]) => {
            // 1. Mock 'rev-parse --verify spidersan/messages' to THROW (branch does not exist)
            if (args.includes('rev-parse') && args.includes('--verify') && args.includes('spidersan/messages')) {
                throw new Error('Branch not found');
            }

            // 2. Mock 'rev-parse --abbrev-ref HEAD' to return a malicious branch name
            if (args.includes('rev-parse') && args.includes('--abbrev-ref') && args.includes('HEAD')) {
                return 'main; rm -rf /';
            }

            // 3. Mock 'rev-parse --git-dir' to succeed (isAvailable check)
            if (args.includes('rev-parse') && args.includes('--git-dir')) {
                return '.git';
            }

            // Default: return something harmless or undefined
            return '';
        });

        // Spy on execFileSync to verify calls later
        const spy = execFileSync as any;

        // Trigger ensureBranch indirectly via send
        try {
            await adapter.send({
                from: 'agent1',
                to: 'agent2',
                subject: 'test',
                body: 'body'
            });
        } catch (e) {
            // Ignore potential errors from later steps (mkdir, etc)
        }

        // Verify that 'checkout' was called with the malicious branch strictly as an argument
        // Expected call: execFileSync('git', ['checkout', 'main; rm -rf /'], ...)

        // Find the specific call to checkout back to original branch
        const checkoutCall = spy.mock.calls.find((call: any[]) =>
            call[0] === 'git' &&
            Array.isArray(call[1]) &&
            call[1][0] === 'checkout' &&
            call[1][1] === 'main; rm -rf /'
        );

        expect(checkoutCall).toBeDefined();

        // Ensure arguments are passed as an array, not a shell string
        expect(Array.isArray(checkoutCall[1])).toBe(true);
        expect(checkoutCall[1].length).toBeGreaterThan(1); // 'checkout', 'branch', ...
    });
});
