import { describe, expect, it } from 'vitest';
import { renderRegisterResult } from '../src/lib/register-renderer.js';

describe('renderRegisterResult', () => {
    it('renders a new registration with the file list', () => {
        const output = renderRegisterResult({
            branchName: 'feat/register',
            files: ['src/index.ts'],
            isUpdate: false,
        });

        expect(output).toContain('Registered branch');
        expect(output).toContain('src/index.ts');
    });

    it('renders an update message', () => {
        const output = renderRegisterResult({
            branchName: 'feat/register',
            files: [],
            isUpdate: true,
        });

        expect(output).toContain('Updated branch');
    });

    it('renders the auto-detected files count', () => {
        const output = renderRegisterResult({
            branchName: 'feat/register',
            files: ['src/index.ts', 'src/auth.ts'],
            isUpdate: false,
            autoDetected: true,
            autoDetectedFiles: ['src/index.ts', 'src/auth.ts'],
        });

        expect(output).toContain('Auto-detected 2 changed file(s)');
    });

    it('renders all files when multiple files are registered', () => {
        const output = renderRegisterResult({
            branchName: 'feat/register',
            files: ['src/index.ts', 'src/auth.ts', 'README.md'],
            isUpdate: false,
        });

        expect(output).toContain('src/index.ts');
        expect(output).toContain('src/auth.ts');
        expect(output).toContain('README.md');
    });
});
