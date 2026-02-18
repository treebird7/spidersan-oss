import { describe, it, expect, vi } from 'vitest';
import { _testable } from '../../src/commands/stale.js';

describe('stale command security', () => {
    describe('updatePendingTaskFile', () => {
        it('should return false for invalid agentId (path traversal)', () => {
            const result = _testable.updatePendingTaskFile('../../../etc/passwd', 'test-branch', 7);
            expect(result).toBe(false);
        });

        it('should return false for invalid agentId (invalid characters)', () => {
            const result = _testable.updatePendingTaskFile('agent; rm -rf /', 'test-branch', 7);
            expect(result).toBe(false);
        });

        it('should return false for empty agentId', () => {
            const result = _testable.updatePendingTaskFile('', 'test-branch', 7);
            expect(result).toBe(false);
        });
    });

    describe('notifyAgentViaMycmail', () => {
        it('should return false for invalid agentId (path traversal)', () => {
            const result = _testable.notifyAgentViaMycmail('../../../etc/passwd', 'test-branch', 7);
            expect(result).toBe(false);
        });

        it('should return false for invalid agentId (invalid characters)', () => {
            const result = _testable.notifyAgentViaMycmail('agent; rm -rf /', 'test-branch', 7);
            expect(result).toBe(false);
        });
    });
});
