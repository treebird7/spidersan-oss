import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'fs';
import { _testable } from '../../src/commands/stale.js';

const { updatePendingTaskFile } = _testable;

// Mock fs to prevent actual file system operations
vi.mock('fs', async (importOriginal) => {
    return {
        ...await importOriginal<typeof import('fs')>(),
        existsSync: vi.fn(),
        readFileSync: vi.fn(),
        appendFileSync: vi.fn(),
    };
});

describe('Stale Command Security', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should prevent path traversal when agentId contains relative paths', () => {
        // Setup mocks
        // Return true only for the malicious path to force the function to choose it
        vi.mocked(fs.existsSync).mockImplementation((pathArg) => {
            const p = pathArg.toString();
            return p.includes('etc');
        });
        vi.mocked(fs.readFileSync).mockReturnValue('');

        // Malicious agent ID that tries to traverse directories
        const maliciousAgentId = '../../etc';
        const branchName = 'test-branch';
        const daysOld = 10;

        // Call the function
        const result = updatePendingTaskFile(maliciousAgentId, branchName, daysOld);

        // Check if appendFileSync was called
        const appendCalls = vi.mocked(fs.appendFileSync).mock.calls;

        // We look for any call that tries to write to a path containing 'etc'
        const attemptedWrite = appendCalls.some(args => {
            const filepath = args[0].toString();
            return filepath.includes('etc');
        });

        // The secure behavior is that we do NOT write to such paths
        expect(attemptedWrite).toBe(false);

        // And the function should probably return false or handle it gracefully
        expect(result).toBe(false);
    });

    it('should prevent path traversal when agentId contains invalid characters', () => {
        vi.mocked(fs.existsSync).mockImplementation((pathArg) => {
            const p = pathArg.toString();
            return p.includes('agent/with/slashes');
        });
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const maliciousAgentId = 'agent/with/slashes';
        const branchName = 'test-branch';
        const daysOld = 10;

        const result = updatePendingTaskFile(maliciousAgentId, branchName, daysOld);

        const appendCalls = vi.mocked(fs.appendFileSync).mock.calls;
        const attemptedWrite = appendCalls.some(args => {
            const filepath = args[0].toString();
            return filepath.includes('agent/with/slashes');
        });

        expect(attemptedWrite).toBe(false);
        expect(result).toBe(false);
    });
});
