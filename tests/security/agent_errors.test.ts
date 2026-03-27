import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { logAgentError, readAgentErrors, clearAgentErrors, getErrorLogPath } from '../../src/lib/agent-errors.js';

describe('Agent Errors Security', () => {
    it('logAgentError should not throw but suppress error when invalid ID is used', () => {
        // the function has a top-level try-catch that suppresses throws
        expect(() => {
            logAgentError('../secrets', 'test', 'error');
        }).not.toThrow();
    });

    it('readAgentErrors should return empty array when invalid ID is used', () => {
        // the function has a top-level try-catch that suppresses throws
        expect(readAgentErrors('../secrets')).toEqual([]);
    });

    it('clearAgentErrors should return false when invalid ID is used', () => {
        // the function has a top-level try-catch that suppresses throws
        expect(clearAgentErrors('../secrets')).toBe(false);
    });

    it('getErrorLogPath should return the correct path for a valid ID', () => {
        expect(getErrorLogPath('test-agent_1')).toBe(path.join(os.homedir(), '.agent-errors', 'test-agent_1.log'));
    });

    it('getErrorLogPath should throw an error for an invalid ID', () => {
        expect(() => getErrorLogPath('../secrets')).toThrow(/Invalid agent ID/);
    });
});
