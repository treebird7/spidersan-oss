/**
 * Git Coordination Branch Message Storage Adapter (Tier 2)
 *
 * Stores messages in an orphan branch: spidersan/messages
 * Structure:
 *   inbox/<agent-id>/<timestamp>_<from>_<subject-slug>.json
 *   outbox/<agent-id>/<timestamp>_<to>_<subject-slug>.json
 *
 * Near-real-time coordination on pull. Works across machines with git remote.
 */

import { spawnSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type {
    MessageStorageAdapter,
    Message,
    SendMessageInput,
    InboxOptions,
    TierStatus,
} from './message-adapter.js';
import { generateMessageId, subjectToSlug } from './message-adapter.js';
import { validateAgentId } from '../lib/security.js';

const MESSAGES_BRANCH = 'spidersan/messages';

export class GitMessagesAdapter implements MessageStorageAdapter {
    private basePath: string;
    private branchInitialized: boolean | null = null;

    constructor(basePath: string = process.cwd()) {
        this.basePath = basePath;
    }

    getTier(): number {
        return 2;
    }

    getTierName(): string {
        return 'git-coordination-branch';
    }

    async isAvailable(): Promise<boolean> {
        // Check if we're in a git repository
        try {
            execFileSync('git', ['rev-parse', '--git-dir'], {
                cwd: this.basePath,
                stdio: 'ignore',
            });
            return true;
        } catch {
            return false;
        }
    }

    async getStatus(): Promise<TierStatus> {
        const available = await this.isAvailable();
        return {
            tier: 2,
            name: this.getTierName(),
            available,
            reason: available
                ? 'Git repository detected'
                : 'Not in a git repository',
        };
    }

    /**
     * Check if the messages branch exists
     */
    private branchExists(): boolean {
        try {
            execFileSync('git', ['rev-parse', '--verify', MESSAGES_BRANCH], {
                cwd: this.basePath,
                stdio: 'ignore',
            });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Initialize the orphan branch if it doesn't exist
     */
    private async ensureBranch(): Promise<void> {
        if (this.branchInitialized) return;

        if (!this.branchExists()) {
            // Create orphan branch with an initial commit
            const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
                cwd: this.basePath,
                encoding: 'utf-8',
            }).trim();

            try {
                // Create orphan branch
                execFileSync('git', ['checkout', '--orphan', MESSAGES_BRANCH], {
                    cwd: this.basePath,
                    stdio: 'ignore',
                });

                // Remove all files from index
                try {
                    execFileSync('git', ['rm', '-rf', '.'], {
                        cwd: this.basePath,
                        stdio: 'ignore',
                    });
                } catch {
                    // Ignore if nothing to remove
                }

                // Create initial structure
                const inboxDir = path.join(this.basePath, 'inbox');
                const outboxDir = path.join(this.basePath, 'outbox');

                fs.mkdirSync(inboxDir, { recursive: true });
                fs.mkdirSync(outboxDir, { recursive: true });

                // Create .gitkeep files
                fs.writeFileSync(path.join(inboxDir, '.gitkeep'), '');
                fs.writeFileSync(path.join(outboxDir, '.gitkeep'), '');


                execFileSync('git', ['add', 'inbox/.gitkeep', 'outbox/.gitkeep'], {
                    cwd: this.basePath,
                    stdio: 'ignore',
                });

                execFileSync('git', ['commit', '-m', 'Initialize spidersan messages branch'], {
                    cwd: this.basePath,
                    stdio: 'ignore',
                });

                // Return to original branch
                execFileSync('git', ['checkout', currentBranch], {
                    cwd: this.basePath,
                    stdio: 'ignore',
                });
            } catch (error) {
                // Try to recover to original branch
                try {
                    execFileSync('git', ['checkout', currentBranch], {
                        cwd: this.basePath,
                        stdio: 'ignore',
                    });
                } catch {
                    // Ignore recovery errors
                }
                throw error;
            }
        }

        this.branchInitialized = true;
    }

    /**
     * Generate filename for a message
     */
    private generateFilename(message: Message, isInbox: boolean): string {
        const timestamp = message.timestamp.getTime();
        const otherAgent = isInbox ? message.from : message.to;
        const slug = subjectToSlug(message.subject);
        return `${timestamp}_${otherAgent}_${slug}.json`;
    }

    /**
     * Read a file from the messages branch without checkout
     */
    private readFromBranch(path: string): string | null {
        try {
            const result = spawnSync('git', ['show', `${MESSAGES_BRANCH}:${path}`], {
                cwd: this.basePath,
                encoding: 'utf-8',
            });
            if (result.status !== 0) return null;
            return result.stdout;
        } catch {
            return null;
        }
    }

    /**
     * List files in a directory on the messages branch
     */
    private listFromBranch(path: string): string[] {
        try {
            const result = spawnSync(
                'git',
                ['ls-tree', '--name-only', `${MESSAGES_BRANCH}`, path + '/'],
                {
                    cwd: this.basePath,
                    encoding: 'utf-8',
                }
            );
            if (result.status !== 0) return [];
            return result.stdout
                .trim()
                .split('\n')
                .filter(line => line && line.endsWith('.json'));
        } catch {
            return [];
        }
    }

    /**
     * Write a file to the messages branch
     */
    private async writeToBranch(
        filePath: string,
        content: string
    ): Promise<boolean> {
        const currentBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
            cwd: this.basePath,
            encoding: 'utf-8',
        }).trim();

        // Stash any uncommitted changes
        let hasStash = false;
        try {
            const stashResult = execFileSync('git', ['stash'], {
                cwd: this.basePath,
                encoding: 'utf-8',
            });
            hasStash = !stashResult.includes('No local changes');
        } catch {
            // No changes to stash
        }

        try {
            // Checkout messages branch
            execFileSync('git', ['checkout', MESSAGES_BRANCH], {
                cwd: this.basePath,
                stdio: 'ignore',
            });

            // Ensure directory exists
            const fullPath = path.join(this.basePath, filePath);
            const dir = path.dirname(fullPath);

            // Security: Use fs module instead of shell commands to prevent injection
            fs.mkdirSync(dir, { recursive: true });

            // Write file directly using fs
            fs.writeFileSync(fullPath, content, { encoding: 'utf-8' });

            // Commit
            execFileSync('git', ['add', filePath], {
                cwd: this.basePath,
                stdio: 'ignore',
            });

            execFileSync('git', ['commit', '-m', `Add message: ${filePath}`], {
                cwd: this.basePath,
                stdio: 'ignore',
            });

            // Try to push if remote exists
            try {
                execFileSync('git', ['push', 'origin', 'spidersan/messages'], {
                    cwd: this.basePath,
                    stdio: 'ignore',
                });
            } catch {
                // No remote or push failed - that's okay
            }

            return true;
        } finally {
            // Return to original branch
            try {
                execFileSync('git', ['checkout', currentBranch], {
                    cwd: this.basePath,
                    stdio: 'ignore',
                });
            } catch {
                // Ignore recovery errors
            }

            // Restore stash if we had one
            if (hasStash) {
                try {
                    execFileSync('git', ['stash', 'pop'], {
                        cwd: this.basePath,
                        stdio: 'ignore',
                    });
                } catch {
                    // Stash pop failed - might have conflicts
                }
            }
        }
    }

    /**
     * Update a file on the messages branch (for marking read)
     */
    private async updateOnBranch(
        path: string,
        content: string
    ): Promise<boolean> {
        return this.writeToBranch(path, content);
    }

    async send(input: SendMessageInput): Promise<Message> {
        await this.ensureBranch();

        // Security: Validate agent IDs to prevent path traversal/injection
        validateAgentId(input.from);
        validateAgentId(input.to);

        const message: Message = {
            id: generateMessageId(),
            from: input.from,
            to: input.to,
            subject: input.subject,
            body: input.body,
            timestamp: new Date(),
            type: input.type || 'info',
            encrypted: input.encrypted || false,
            read: false,
            branch: input.branch,
            files: input.files,
        };

        const filename = this.generateFilename(message, true);
        const inboxPath = `inbox/${message.to}/${filename}`;
        const outboxPath = `outbox/${message.from}/${filename}`;

        const content = JSON.stringify(message, null, 2);

        // Write to recipient's inbox
        await this.writeToBranch(inboxPath, content);

        // Write to sender's outbox (same content)
        await this.writeToBranch(outboxPath, content);

        return message;
    }

    async inbox(agentId: string, options: InboxOptions = {}): Promise<Message[]> {
        await this.ensureBranch();

        // Try to pull latest if remote exists
        try {
            execFileSync('git', ['fetch', 'origin', 'spidersan/messages:spidersan/messages'], {
                cwd: this.basePath,
                stdio: 'ignore',
            });
        } catch {
            // No remote or fetch failed
        }

        const files = this.listFromBranch(`inbox/${agentId}`);
        const messages: Message[] = [];

        for (const file of files) {
            const content = this.readFromBranch(file);
            if (content) {
                try {
                    const msg = JSON.parse(content) as Message;
                    msg.timestamp = new Date(msg.timestamp);
                    messages.push(msg);
                } catch {
                    // Skip invalid JSON
                }
            }
        }

        // Sort by timestamp descending
        messages.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        let result = messages;

        if (options.unread) {
            result = result.filter(msg => !msg.read);
        }

        if (options.limit && options.limit > 0) {
            result = result.slice(0, options.limit);
        }

        return result;
    }

    async read(messageId: string): Promise<Message | null> {
        await this.ensureBranch();

        // We need to search through all inbox directories
        // This is inefficient but necessary without an index
        try {
            const result = spawnSync(
                'git',
                ['ls-tree', '-r', '--name-only', MESSAGES_BRANCH, 'inbox/'],
                {
                    cwd: this.basePath,
                    encoding: 'utf-8',
                }
            );

            if (result.status !== 0) return null;

            const files = result.stdout.trim().split('\n').filter(Boolean);

            for (const file of files) {
                const content = this.readFromBranch(file);
                if (content) {
                    try {
                        const msg = JSON.parse(content) as Message;
                        if (msg.id === messageId) {
                            msg.timestamp = new Date(msg.timestamp);
                            return msg;
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        } catch {
            // Error listing files
        }

        return null;
    }

    async markRead(messageId: string): Promise<boolean> {
        const message = await this.read(messageId);
        if (!message) return false;

        message.read = true;

        const filename = this.generateFilename(message, true);
        const inboxPath = `inbox/${message.to}/${filename}`;

        return this.updateOnBranch(inboxPath, JSON.stringify(message, null, 2));
    }
}
