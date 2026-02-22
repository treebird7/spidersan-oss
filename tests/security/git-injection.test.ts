
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitMessagesAdapter } from '../../src/storage/git-messages';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('GitMessagesAdapter Security', () => {
    let tempDir: string;
    let originalCwd: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spidersan-test-'));
        process.chdir(tempDir);

        // Setup git repo
        execSync('git init', { stdio: 'ignore' });
        execSync('git config user.email "test@example.com"', { stdio: 'ignore' });
        execSync('git config user.name "Test User"', { stdio: 'ignore' });
        execSync('touch file', { stdio: 'ignore' });
        execSync('git add file', { stdio: 'ignore' });
        execSync('git commit -m "initial"', { stdio: 'ignore' });
    });

    afterEach(() => {
        process.chdir(originalCwd);
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
    });

    it('should prevent command injection via malicious branch names', async () => {
        const pwnScript = path.join(tempDir, 'pwn');
        const pwnedFile = path.join(tempDir, 'pwned.txt');

        // Create a malicious script that creates a file
        fs.writeFileSync(pwnScript, '#!/bin/sh\ntouch pwned.txt\n');
        fs.chmodSync(pwnScript, '755');

        // Create a branch name that attempts to execute the script
        // Note: Branch names can contain / and ; and .
        // We use a relative path to execute the script in the current directory
        const maliciousBranchName = 'feature/test;./pwn';

        // Create and checkout malicious branch
        try {
            execSync(`git checkout -b "${maliciousBranchName}"`, { stdio: 'ignore' });
        } catch (e) {
            // Depending on git version or config, this might fail.
            // But we verified check-ref-format allows it.
            // If git checkout fails, we can't test this specific vector easily.
            console.log('Failed to create malicious branch, skipping test execution check');
            return;
        }

        const adapter = new GitMessagesAdapter(tempDir);

        // This will trigger ensureBranch, which:
        // 1. Detects current branch is 'feature/test;./pwn'
        // 2. Creates spidersan/messages branch
        // 3. Tries to switch back to 'feature/test;./pwn' using execSync
        // Vulnerable: execSync('git checkout feature/test;./pwn')
        // Execution: git checkout feature/test (fails) ; ./pwn (executes)

        try {
            await adapter.send({
                from: 'agent1',
                to: 'agent2',
                subject: 'test',
                body: 'test'
            });
        } catch (e) {
            // Expected to fail because git checkout fails or branch creation fails
        }

        // Check if the script was executed
        const wasExecuted = fs.existsSync(pwnedFile);

        // If vulnerable, wasExecuted will be true.
        // If fixed, wasExecuted should be false.

        // We assert false to verify the fix.
        // Before fix, this expectation should fail.
        expect(wasExecuted).toBe(false);
    });
});
