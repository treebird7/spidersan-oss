/**
 * Security validation tests
 */

import { describe, it, expect } from 'vitest';
import {
    validateAgentId,
    validateBranchName,
    validateTaskId,
    validateFilePath,
    sanitizeText,
    sanitizeFilePaths,
    patterns,
} from '../src/lib/security.js';

describe('security validation', () => {
    it('accepts valid agent IDs', () => {
        expect(validateAgentId('codex-52')).toBe('codex-52');
        expect(validateAgentId('Agent_01')).toBe('Agent_01');
    });

    it('rejects invalid agent IDs', () => {
        expect(() => validateAgentId('bad id')).toThrow();
        expect(() => validateAgentId('bad;rm -rf /')).toThrow();
    });

    it('accepts valid branch names', () => {
        expect(validateBranchName('feature/new-ui')).toBe('feature/new-ui');
        expect(validateBranchName('task/DASH-001-A')).toBe('task/DASH-001-A');
    });

    it('rejects invalid branch names', () => {
        expect(() => validateBranchName('bad branch')).toThrow();
        expect(() => validateBranchName('bad;branch')).toThrow();
    });

    it('accepts valid task IDs', () => {
        expect(validateTaskId('SEC-123')).toBe('SEC-123');
        expect(validateTaskId('dash_01')).toBe('dash_01');
    });

    it('rejects invalid task IDs', () => {
        expect(() => validateTaskId('bad task')).toThrow();
        expect(() => validateTaskId('bad/task')).toThrow();
    });

    it('accepts valid file paths', () => {
        expect(validateFilePath('src/app.ts')).toBe('src/app.ts');
        expect(validateFilePath('docs/README.md')).toBe('docs/README.md');
    });

    it('rejects invalid file paths', () => {
        expect(() => validateFilePath('../secrets')).toThrow();
        expect(() => validateFilePath('bad|path')).toThrow();
    });

    it('sanitizes shell metacharacters from text', () => {
        const input = 'hello; $(rm -rf /) test';
        const sanitized = sanitizeText(input);
        const shellRegex = new RegExp(patterns.SHELL_METACHARACTERS.source);
        expect(shellRegex.test(sanitized)).toBe(false);
    });

    it('filters invalid file paths', () => {
        const files = ['src/app.ts', '../secrets', 'docs/readme.md', 'bad|path'];
        expect(sanitizeFilePaths(files)).toEqual(['src/app.ts', 'docs/readme.md']);
    });
});
