import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

export const registerCommand = new Command('register')
    .description('Register the current branch with files being modified')
    .option('-f, --files <files>', 'Comma-separated list of files being modified')
    .option('-d, --description <desc>', 'Description of what this branch does')
    .option('-a, --agent <agent>', 'Agent identifier (e.g., claude-code, cursor)')
    .action(async (options) => {
        const storage = await getStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = getCurrentBranch();
        const files = options.files ? options.files.split(',').map((f: string) => f.trim()) : [];

        // Check if branch already registered
        const existing = await storage.get(branchName);
        if (existing) {
            // Update existing registration
            await storage.update(branchName, {
                files: [...new Set([...existing.files, ...files])],
                description: options.description || existing.description,
                agent: options.agent || existing.agent,
            });
            console.log(`🕷️ Updated branch: ${branchName}`);
        } else {
            // New registration
            await storage.register({
                name: branchName,
                files,
                status: 'active',
                description: options.description,
                agent: options.agent,
            });
            console.log(`🕷️ Registered branch: ${branchName}`);
        }

        if (files.length > 0) {
            console.log(`   Files: ${files.join(', ')}`);
        }
    });
