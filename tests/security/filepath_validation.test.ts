
import { describe, it, expect } from 'vitest';
import { validateFilePath } from '../../src/lib/security.js';

describe('validateFilePath', () => {
    it('should allow file paths with spaces', () => {
        expect(() => validateFilePath('file with spaces.txt')).not.toThrow();
    });

    it('should block path traversal', () => {
        expect(() => validateFilePath('../passwd')).toThrow('Path traversal not allowed');
        expect(() => validateFilePath('foo/../bar')).toThrow('Path traversal not allowed');
    });

    it('should block invalid characters', () => {
        expect(() => validateFilePath('file|pipe')).toThrow('Invalid file path');
        expect(() => validateFilePath('file;semicolon')).toThrow('Invalid file path');
    });
});
