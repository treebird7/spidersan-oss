import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updatePendingTaskFile } from '../../src/commands/stale.js';
import * as fs from 'fs';
import { resolve } from 'path';

// Mock fs module
vi.mock('fs', () => ({
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    resolve: vi.fn(),
}));

describe('Security: Stale Command Path Traversal', () => {
    const cwd = process.cwd();

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should prevent path traversal via agentId', () => {
        const maliciousAgentId = '../../tmp';
        const maliciousPath = resolve(cwd, `../${maliciousAgentId}/.pending_task.md`);

        // Mock existsSync to return true for the malicious path
        vi.mocked(fs.existsSync).mockImplementation((path: any) => {
            return path === maliciousPath;
        });

        // Mock readFileSync to avoid crash
        vi.mocked(fs.readFileSync).mockReturnValue('');

        const result = updatePendingTaskFile(maliciousAgentId, 'stale-branch', 10);

        // It should fail because validation blocks invalid agentId
        expect(result).toBe(false);

        // Verify it did NOT write to the file
        expect(fs.appendFileSync).not.toHaveBeenCalled();
    });
});
