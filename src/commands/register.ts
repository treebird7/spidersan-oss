import { Command } from 'commander';
import { execSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import * as readline from 'readline';
import { loadConfig } from '../lib/config.js';
import { validateFilePath, validateAgentId } from '../lib/security.js';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function getChangedFiles(): string[] {
    try {
        // Get files changed from main or last commit
        const output = execSync(
            'git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null || git diff --name-only HEAD',
            { encoding: 'utf-8' }
        );
        return output.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

export function validateRegistrationFiles(files: string[]): void {
    files.forEach(f => validateFilePath(f));
}

async function promptForFiles(detectedFiles: string[]): Promise<string[]> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        if (detectedFiles.length > 0) {
            console.log('\n🕷️ Detected changed files:');
            detectedFiles.forEach((f, i) => console.log(`   ${i + 1}. ${f}`));
            console.log('');

            rl.question('Use these files? [Y/n/edit]: ', (answer) => {
                rl.close();
                const a = answer.toLowerCase().trim();
                if (a === '' || a === 'y' || a === 'yes') {
                    resolve(detectedFiles);
                } else if (a === 'n' || a === 'no') {
                    resolve([]);
                } else {
                    // Let them enter custom files
                    console.log('   Enter comma-separated files, or leave empty:');
                    const rl2 = readline.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    rl2.question('   Files: ', (files) => {
                        rl2.close();
                        resolve(files ? files.split(',').map(f => f.trim()) : []);
                    });
                }
            });
        } else {
            rl.question('Enter files (comma-separated) or leave empty: ', (files) => {
                rl.close();
                resolve(files ? files.split(',').map(f => f.trim()) : []);
            });
        }
    });
}

export const registerCommand = new Command('register')
    .description('Register the current branch with files being modified')
    .option('-f, --files <files>', 'Comma-separated list of files being modified')
    .option('-d, --description <desc>', 'Description of what this branch does')
    .option('-a, --agent <agent>', 'Agent identifier (e.g., claude-code, cursor)')
    .option('-i, --interactive', 'Interactive mode (prompt for files)')
    .option('--auto', 'Auto-detect files from git diff')
    .action(async (options) => {
        const storage = await getStorage();
        const config = await loadConfig();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = getCurrentBranch();
        let files: string[] = [];

        if (options.files) {
            files = options.files.split(',').map((f: string) => f.trim());
        } else if (options.auto) {
            files = getChangedFiles();
            if (files.length > 0) {
                console.log(`🕷️ Auto-detected ${files.length} changed file(s)`);
            }
        } else if (options.interactive) {
            const detected = getChangedFiles();
            files = await promptForFiles(detected);
        }

        // Security: Validate ALL file paths before storing (Sentinel 2026-02-18)
        try {
            validateRegistrationFiles(files);
        } catch (err) {
            if (err instanceof Error) {
                console.error(`❌ Security Error: ${err.message}`);
            } else {
                console.error('❌ Security Error: Invalid file path');
            }
            process.exit(1);
        }

        const configuredAgent = config.agent.name?.trim();
        const resolvedAgent = (options.agent || process.env.SPIDERSAN_AGENT || configuredAgent || '').trim() || undefined;

        // Security: Validate agent ID if present
        if (resolvedAgent) {
            try {
                validateAgentId(resolvedAgent);
            } catch (err) {
                if (err instanceof Error) {
                    console.error(`❌ Security Error: ${err.message}`);
                }
                process.exit(1);
            }
        }

        // Check if branch already registered
        const existing = await storage.get(branchName);

        if (existing) {
            // Update existing registration
            await storage.update(branchName, {
                files: [...new Set([...existing.files, ...files])],
                description: options.description || existing.description,
                agent: resolvedAgent ?? existing.agent,
            });
            console.log(`🕷️ Updated branch: ${branchName}`);
        } else {
            // New registration
            await storage.register({
                name: branchName,
                files,
                status: 'active',
                description: options.description,
                agent: resolvedAgent,
            });
            console.log(`🕷️ Registered branch: ${branchName}`);
        }

        if (files.length > 0) {
            console.log(`   Files: ${files.join(', ')}`);
        }
    });
