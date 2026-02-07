/**
 * Spidersan Core Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// Test utilities
function createTempDir(): string {
    const id = randomBytes(4).toString('hex');
    const dir = join(tmpdir(), `spidersan-test-${Date.now()}-${id}`);
    mkdirSync(dir, { recursive: true });
    return dir;
}

function cleanupTempDir(dir: string): void {
    if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('LocalStorage', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it('should initialize storage', async () => {
        const { LocalStorage } = await import('../src/storage/local.js');
        const storage = new LocalStorage(tempDir);

        await storage.init();

        expect(await storage.isInitialized()).toBe(true);
        expect(existsSync(join(tempDir, '.spidersan', 'registry.json'))).toBe(true);
    });

    it('should register a branch', async () => {
        const { LocalStorage } = await import('../src/storage/local.js');
        const storage = new LocalStorage(tempDir);
        await storage.init();

        const branch = await storage.register({
            name: 'feature/test',
            files: ['src/test.ts'],
            status: 'active',
        });

        expect(branch.name).toBe('feature/test');
        expect(branch.files).toEqual(['src/test.ts']);
    });

    it('should list branches', async () => {
        const { LocalStorage } = await import('../src/storage/local.js');
        const storage = new LocalStorage(tempDir);
        await storage.init();

        await storage.register({ name: 'branch-1', files: ['a.ts'], status: 'active' });
        await storage.register({ name: 'branch-2', files: ['b.ts'], status: 'active' });

        const branches = await storage.list();
        expect(branches.length).toBe(2);
    });

    it('should detect file conflicts', async () => {
        const { LocalStorage } = await import('../src/storage/local.js');
        const storage = new LocalStorage(tempDir);
        await storage.init();

        await storage.register({ name: 'branch-1', files: ['shared.ts', 'a.ts'], status: 'active' });
        await storage.register({ name: 'branch-2', files: ['shared.ts', 'b.ts'], status: 'active' });

        const branches = await storage.list();
        const branch1 = branches.find(b => b.name === 'branch-1');
        const branch2 = branches.find(b => b.name === 'branch-2');

        expect(branch1).toBeDefined();
        expect(branch2).toBeDefined();

        // Check for overlapping files
        const overlap = branch1!.files.filter(f => branch2!.files.includes(f));
        expect(overlap).toContain('shared.ts');
    });

    it('should unregister a branch', async () => {
        const { LocalStorage } = await import('../src/storage/local.js');
        const storage = new LocalStorage(tempDir);
        await storage.init();

        await storage.register({ name: 'to-remove', files: ['x.ts'], status: 'active' });
        expect(await storage.get('to-remove')).not.toBeNull();

        await storage.unregister('to-remove');
        expect(await storage.get('to-remove')).toBeNull();
    });
});

describe('Config', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = createTempDir();
    });

    afterEach(() => {
        cleanupTempDir(tempDir);
    });

    it('should load default config when no file exists', async () => {
        const { loadConfig } = await import('../src/lib/config.js');
        const config = await loadConfig(tempDir);

        expect(config.readyCheck.enableWipDetection).toBe(true);
        expect(config.readyCheck.wipPatterns).toContain('TODO');
    });

    it('should merge user config with defaults', async () => {
        const { loadConfig } = await import('../src/lib/config.js');

        writeFileSync(
            join(tempDir, '.spidersanrc'),
            JSON.stringify({ readyCheck: { wipPatterns: ['CUSTOM'] } })
        );

        const config = await loadConfig(tempDir);

        expect(config.readyCheck.wipPatterns).toContain('CUSTOM');
        expect(config.readyCheck.enableWipDetection).toBe(true); // Default preserved
    });

    it('should handle invalid JSON gracefully', async () => {
        const { loadConfig } = await import('../src/lib/config.js');

        writeFileSync(join(tempDir, '.spidersanrc'), 'not valid json {{{');

        // Should return defaults without crashing
        const config = await loadConfig(tempDir);
        expect(config.readyCheck.enableWipDetection).toBe(true);
    });
});

describe('Errors', () => {
    it('should create structured errors', async () => {
        const { SpidersanError, StorageError, formatError } = await import('../src/lib/errors.js');

        const error = new StorageError('Failed to write', 'register');
        expect(error.code).toBe('STORAGE_ERROR');
        expect(error.operation).toBe('register');

        const formatted = formatError(error);
        expect(formatted).toContain('Failed to write');
    });
});

describe('Version', () => {
    it('should have dynamic version from package.json', async () => {
        const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    });
});
