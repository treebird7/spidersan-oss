import { describe, it, expect, vi, afterEach } from 'vitest';
import { GitMessagesAdapter } from '../../src/storage/git-messages.js';
import * as cp from 'child_process';
import * as fs from 'fs';

// Mock child_process
vi.mock('child_process', async (importOriginal) => {
    return {
        ...await importOriginal<typeof import('child_process')>(),
        execSync: vi.fn(),
        execFileSync: vi.fn(),
        spawnSync: vi.fn(),
    };
});

// Mock fs to prevent actual file system operations
vi.mock('fs', async (importOriginal) => {
    return {
        ...await importOriginal<typeof import('fs')>(),
        mkdirSync: vi.fn(),
        writeFileSync: vi.fn(),
        readFileSync: vi.fn(),
        readdirSync: vi.fn(() => []),
        existsSync: vi.fn(() => false),
        statSync: vi.fn(),
    };
});

describe('GitMessagesAdapter Security', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should use execFileSync to prevent command injection when switching branches', async () => {
        const adapter = new GitMessagesAdapter();
        const maliciousBranch = 'main; touch pwned';

        // Setup mocks — source code uses execFileSync for all git calls
        vi.mocked(cp.execFileSync).mockImplementation((_file, args, options) => {
            const argsArr = args as string[];
            const returnsString = (options as Record<string, unknown>)?.encoding === 'utf-8';
            // Mock branchExists: git rev-parse --verify spidersan/messages -> fail so it creates
            if (argsArr?.[0] === 'rev-parse' && argsArr?.[1] === '--verify') throw new Error('Not found');
            // Mock getCurrentBranch: git rev-parse --abbrev-ref HEAD -> return malicious payload
            if (argsArr?.[0] === 'rev-parse' && argsArr?.[1] === '--abbrev-ref')
                return returnsString ? maliciousBranch : Buffer.from(maliciousBranch);
            // Mock stash: return "No local changes" to skip stash pop
            if (argsArr?.[0] === 'stash' && argsArr?.length === 1)
                return returnsString ? 'No local changes to save' : Buffer.from('No local changes to save');
            // All other execFileSync calls succeed
            return returnsString ? '' : Buffer.from('');
        });

        // Trigger ensureBranch via send
        try {
            await adapter.send({
                from: 'alice',
                to: 'bob',
                subject: 'hi',
                body: 'msg'
            });
        } catch (e) {
            // Ignore unrelated errors
        }

        // Check if execSync was called with the dangerous string
        const dangerousCall = vi.mocked(cp.execSync).mock.calls.find(call => {
            const cmd = call[0].toString();
            return cmd.includes(`git checkout ${maliciousBranch}`);
        });

        // The vulnerability is fixed if execSync is NOT called with the malicious string
        expect(dangerousCall).toBeUndefined();

        // Instead, execFileSync MUST be used correctly
        const safeCall = vi.mocked(cp.execFileSync).mock.calls.find(call =>
            call[0] === 'git' &&
            Array.isArray(call[1]) &&
            call[1][0] === 'checkout' &&
            call[1][1] === maliciousBranch
        );

        expect(safeCall).toBeDefined();

        // Verify fs calls were mocked (optional but good for debugging)
        expect(vi.mocked(fs.mkdirSync)).toHaveBeenCalled();
        expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalled();
    });
});
