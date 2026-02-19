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

        // Mock fs.existsSync to simulate directories existing
        vi.mocked(fs.existsSync).mockReturnValue(false);

        // Setup comprehensive mock for execFileSync
        vi.mocked(cp.execFileSync).mockImplementation((file: string, args?: readonly string[], options?: any) => {
            if (file !== 'git') return Buffer.from('');
            if (!args) return Buffer.from('');

            const command = args[0];

            // Mock isAvailable check
            if (command === 'rev-parse' && args[1] === '--git-dir') {
                return Buffer.from('.git');
            }

            // Mock branchExists check -> fail so it tries to create
            if (command === 'rev-parse' && args[1] === '--verify' && args[2] === 'spidersan/messages') {
                throw new Error('Branch not found');
            }

            // Mock getCurrentBranch -> return malicious payload
            // Check if encoding is specified in options
            if (command === 'rev-parse' && args[1] === '--abbrev-ref' && args[2] === 'HEAD') {
                if (options?.encoding === 'utf-8') {
                    return maliciousBranch as any; // Return string when encoding is specified
                }
                return Buffer.from(maliciousBranch);
            }

            // Mock other git operations
            if (command === 'checkout') return Buffer.from('');
            if (command === 'rm') return Buffer.from('');
            if (command === 'add') return Buffer.from('');
            if (command === 'commit') return Buffer.from('');
            if (command === 'stash') {
                if (options?.encoding === 'utf-8') {
                    return 'No local changes to save' as any;
                }
                return Buffer.from('No local changes to save');
            }
            if (command === 'push') return Buffer.from('');

            return Buffer.from('');
        });

        // Ensure execSync is NOT used at all
        vi.mocked(cp.execSync).mockImplementation(() => {
            throw new Error('execSync should not be called - use execFileSync instead');
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
