import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import * as readline from 'readline';
import { loadConfig } from '../lib/config.js';
import { validateAgentId, sanitizeFilePaths, validateFilePath } from '../lib/security.js';
import { logActivity } from '../lib/activity.js';

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

// Path prefixes that are never meaningful for conflict tracking
const EXCLUDED_PATH_PREFIXES = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    '.next/',
    'target/',       // Rust/Cargo build output
    '.turbo/',
    '.cache/',
];

export function isExcludedPath(file: string): boolean {
    return EXCLUDED_PATH_PREFIXES.some(prefix => file.startsWith(prefix));
}

function getChangedFiles(): string[] {
    const diffStrategies: string[][] = [
        ['diff', '--name-only', 'main...HEAD'],
        ['diff', '--name-only', 'HEAD~1'],
        ['diff', '--name-only', 'HEAD'],
    ];

    for (const args of diffStrategies) {
        try {
            const output = execFileSync('git', args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
            if (output) return output.trim().split('\n').filter(f => f && !isExcludedPath(f));
        } catch {
            continue;
        }
    }
    return [];
}

export function validateRegistrationFiles(files: string[]): void {
    for (const file of files) {
        validateFilePath(file);
    }
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
            files = sanitizeFilePaths(
                options.files.split(',').map((f: string) => f.trim()).filter((f: string) => f && !isExcludedPath(f))
            );
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
        const rawAgent = (options.agent || process.env.SPIDERSAN_AGENT || configuredAgent || '').trim() || undefined;
        let resolvedAgent = rawAgent;
        if (resolvedAgent) {
            try {
                resolvedAgent = validateAgentId(resolvedAgent);
            } catch {
                console.error(`❌ Invalid agent ID: "${resolvedAgent}". Must be alphanumeric with - or _.`);
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
            logActivity({ event: 'register', branch: branchName, agent: resolvedAgent ?? undefined, details: { files, description: options.description, updated: true } });
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
            logActivity({ event: 'register', branch: branchName, agent: resolvedAgent ?? undefined, details: { files, description: options.description } });
        }

        if (files.length > 0) {
            console.log(`   Files: ${files.join(', ')}`);
        }
    });
