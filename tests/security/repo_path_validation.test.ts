import { describe, it, expect } from 'vitest';
import { validateRepoPath } from '../../src/lib/security.js';
import { join, resolve } from 'path';

describe('validateRepoPath', () => {
    const root = process.cwd();

    it('should allow paths inside the repo', () => {
        const p1 = 'src/index.ts';
        expect(validateRepoPath(p1, root)).toBe(resolve(root, p1));

        const p2 = './README.md';
        expect(validateRepoPath(p2, root)).toBe(resolve(root, p2));
    });

    it('should block paths outside the repo', () => {
        // Relative traversal
        expect(() => validateRepoPath('../outside.txt', root)).toThrow(/resolves outside/);

        // Absolute path outside (assuming /tmp is outside cwd)
        // If cwd is /tmp, this test might fail, so let's use a path guaranteed to be outside
        const outside = resolve(root, '../outside.txt');
        expect(() => validateRepoPath(outside, root)).toThrow(/resolves outside/);
    });

    it('should allow paths with .. that resolve inside', () => {
        expect(validateRepoPath('src/../README.md', root)).toBe(resolve(root, 'README.md'));
    });

    it('should block absolute paths pointing to sensitive files', () => {
        // e.g. /etc/passwd (on linux/mac)
        // Check if platform is win32, skip /etc/passwd
        if (process.platform !== 'win32') {
             expect(() => validateRepoPath('/etc/passwd', root)).toThrow(/resolves outside/);
        }
    });
});
