import { describe, it, expect } from 'vitest';
import { validateRegistrationFiles } from '../../src/commands/register.js';

describe('validateRegistrationFiles', () => {
    it('should allow valid file paths', () => {
        expect(() => validateRegistrationFiles([
            'src/index.ts',
            'README.md',
            'tests/my-test.ts',
            'folder/subfolder/file.txt'
        ])).not.toThrow();
    });

    it('should reject file paths with traversal characters', () => {
        expect(() => validateRegistrationFiles([
            'src/index.ts',
            '../etc/passwd'
        ])).toThrow(/Path traversal/);

        expect(() => validateRegistrationFiles([
            'foo/../../bar'
        ])).toThrow(/Path traversal/);
    });

    it('should reject file paths with invalid characters', () => {
        expect(() => validateRegistrationFiles([
            'valid.ts',
            'invalid;rm -rf /'
        ])).toThrow(/Invalid file path/);

        expect(() => validateRegistrationFiles([
            'file|pipe'
        ])).toThrow(/Invalid file path/);
    });

    it('should reject file paths with command injection attempts', () => {
        expect(() => validateRegistrationFiles([
            '$(whoami).txt'
        ])).toThrow(/Invalid file path/);

        expect(() => validateRegistrationFiles([
            '`date`.txt'
        ])).toThrow(/Invalid file path/);
    });

    it('should validate all files in the list', () => {
        // First file is valid, second is invalid
        expect(() => validateRegistrationFiles([
            'src/good.ts',
            'src/bad;file.ts'
        ])).toThrow(/Invalid file path/);
    });
});
