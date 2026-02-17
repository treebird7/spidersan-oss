
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { GitMessagesAdapter } from '../src/storage/git-messages.js';

function createTempGitRepo(): string {
    const dir = join(tmpdir(), `spidersan-test-git-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    // Initialize git repo
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "you@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Your Name"', { cwd: dir, stdio: 'ignore' });
    // Create initial commit
    execSync('touch README.md', { cwd: dir, stdio: 'ignore' });
    execSync('git add README.md', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: dir, stdio: 'ignore' });
    return dir;
}

function cleanupTempDir(dir: string): void {
    if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('GitMessagesAdapter', () => {
    let repoPath: string;

    beforeEach(() => {
        repoPath = createTempGitRepo();
    });

    afterEach(() => {
        cleanupTempDir(repoPath);
    });

    it('should initialize available status', async () => {
        const adapter = new GitMessagesAdapter(repoPath);
        expect(await adapter.isAvailable()).toBe(true);
        const status = await adapter.getStatus();
        expect(status.available).toBe(true);
        expect(status.tier).toBe(2);
    });

    it('should send a message and create the messages branch', async () => {
        const adapter = new GitMessagesAdapter(repoPath);
        const msg = await adapter.send({
            from: 'agent-a',
            to: 'agent-b',
            subject: 'Hello',
            body: 'World'
        });

        expect(msg.from).toBe('agent-a');
        expect(msg.to).toBe('agent-b');
        expect(msg.id).toBeDefined();

        // Check if messages branch exists
        const branches = execSync('git branch', { cwd: repoPath, encoding: 'utf-8' });
        expect(branches).toContain('spidersan/messages');

        // Verify message exists in inbox
        const inbox = await adapter.inbox('agent-b');
        expect(inbox).toHaveLength(1);
        expect(inbox[0].body).toBe('World');
        expect(inbox[0].subject).toBe('Hello');
    });

    it('should handle reading and marking as read', async () => {
        const adapter = new GitMessagesAdapter(repoPath);
        const msg = await adapter.send({
            from: 'sender',
            to: 'receiver',
            subject: 'Read Me',
            body: 'Content'
        });

        // Read message
        const readMsg = await adapter.read(msg.id);
        expect(readMsg).toBeDefined();
        expect(readMsg?.id).toBe(msg.id);
        expect(readMsg?.read).toBe(false);

        // Mark as read
        await adapter.markRead(msg.id);

        // Verify it is read
        const updatedMsg = await adapter.read(msg.id);
        expect(updatedMsg?.read).toBe(true);

        // Verify inbox filtering
        const unreadInbox = await adapter.inbox('receiver', { unread: true });
        expect(unreadInbox).toHaveLength(0);

        const fullInbox = await adapter.inbox('receiver');
        expect(fullInbox).toHaveLength(1);
    });
});
