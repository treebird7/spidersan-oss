
import { describe, it, expect } from 'vitest';
import { validateRegistrationFiles } from '../../src/commands/register.js';

describe('validateRegistrationFiles', () => {
    it('should throw an error for invalid file paths', () => {
        const invalidFiles = ['valid.ts', '../../etc/passwd'];
        expect(() => validateRegistrationFiles(invalidFiles)).toThrow();
    });

    it('should pass for valid file paths', () => {
        const validFiles = ['src/index.ts', 'README.md'];
        expect(() => validateRegistrationFiles(validFiles)).not.toThrow();
    });
});
