import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { GitMessagesAdapter } from '../src/storage/git-messages';

const TEST_DIR = 'test-repo-vuln';

describe('GitMessagesAdapter Vulnerability', () => {
    beforeAll(() => {
        if (existsSync(TEST_DIR)) {
            rmSync(TEST_DIR, { recursive: true, force: true });
        }
        mkdirSync(TEST_DIR);
        execSync('git init', { cwd: TEST_DIR });
        execSync('git config user.email "test@example.com"', { cwd: TEST_DIR });
        execSync('git config user.name "Test User"', { cwd: TEST_DIR });
        execSync('touch README.md', { cwd: TEST_DIR });
        execSync('git add README.md', { cwd: TEST_DIR });
        execSync('git commit -m "Initial commit"', { cwd: TEST_DIR });
    });

    afterAll(() => {
        if (existsSync(TEST_DIR)) {
            rmSync(TEST_DIR, { recursive: true, force: true });
        }
    });

    it('should reject invalid agent IDs and prevent command injection', async () => {
        const adapter = new GitMessagesAdapter(TEST_DIR);
        const maliciousAgentId = 'agent; touch pwned; #';

        // Should throw validation error
        await expect(adapter.send({
            from: 'innocent',
            to: maliciousAgentId,
            subject: 'hello',
            body: 'world'
        })).rejects.toThrow();

        const pwnedPath = join(TEST_DIR, 'pwned');
        // Should NOT exist
        expect(existsSync(pwnedPath)).toBe(false);
    });
});
