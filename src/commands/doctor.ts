/**
 * spidersan doctor
 * 
 * Diagnose common issues with Spidersan setup.
 */

import { Command } from 'commander';
import { existsSync, statSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { getStorage } from '../storage/index.js';

interface Check {
    name: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
}

function checkGitContext(): Check {
    try {
        execSync('git rev-parse --git-dir', { stdio: 'ignore' });
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
        return { name: 'Git Context', status: 'ok', message: `In git repo, branch: ${branch}` };
    } catch {
        return { name: 'Git Context', status: 'warn', message: 'Not in a git repository' };
    }
}

function checkLocalStorage(): Check {
    const localPath = join(process.cwd(), '.spidersan', 'registry.json');
    if (existsSync(localPath)) {
        const stats = statSync(localPath);
        return { name: 'Local Storage', status: 'ok', message: `Found (.spidersan/registry.json, ${stats.size} bytes)` };
    }
    return { name: 'Local Storage', status: 'warn', message: 'Not initialized locally (run: spidersan init)' };
}

function checkGlobalStorage(): Check {
    const globalPath = join(homedir(), '.spidersan', 'registry.json');
    if (existsSync(globalPath)) {
        const stats = statSync(globalPath);
        return { name: 'Global Storage', status: 'ok', message: `Found (~/.spidersan/registry.json, ${stats.size} bytes)` };
    }
    return { name: 'Global Storage', status: 'warn', message: 'No global registry' };
}

function checkEnvConflict(): Check {
    const localEnv = join(process.cwd(), '.env');
    if (existsSync(localEnv)) {
        try {
            const content = readFileSync(localEnv, 'utf-8');

            // Check for concatenation bug (missing newlines between vars)
            // Pattern: VALUE without newline before next KEY=
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                // Check for multiple = on same line (concatenation bug)
                const equalSigns = (line.match(/=/g) || []).length;
                if (equalSigns > 1 && !line.startsWith('#')) {
                    return {
                        name: '.env Lint',
                        status: 'error',
                        message: `.env line ${i + 1} has multiple '=' - likely missing newline (concatenation bug)`
                    };
                }
                // Check for vars that look concatenated (e.g., VALUE_WITHOUT_NEWLINENEXT_VAR=)
                if (line.includes('://') && line.includes('=') && line.indexOf('=') < line.indexOf('://')) {
                    // URL in value is fine, but check if there's another = after
                    const afterUrl = line.substring(line.indexOf('://') + 3);
                    if (afterUrl.includes('=') && !afterUrl.startsWith('=')) {
                        return {
                            name: '.env Lint',
                            status: 'error',
                            message: `.env line ${i + 1} appears corrupted - check for missing newlines`
                        };
                    }
                }
            }

            // Check Supabase conflict
            if (content.includes('SUPABASE_URL') || content.includes('SUPABASE_KEY')) {
                return {
                    name: '.env Lint',
                    status: 'warn',
                    message: 'Local .env has Supabase vars - may conflict with mycmail'
                };
            }
        } catch {
            // Ignore read errors
        }
    }
    return { name: '.env Lint', status: 'ok', message: 'No .env issues detected' };
}

function checkMycmail(): Check {
    try {
        execSync('which mycmail', { stdio: 'ignore' });
        const version = execSync('mycmail --version 2>/dev/null || echo "unknown"', { encoding: 'utf-8' }).trim();
        return { name: 'Myceliumail', status: 'ok', message: `Installed (${version})` };
    } catch {
        return { name: 'Myceliumail', status: 'warn', message: 'Not installed (optional)' };
    }
}

function checkLicense(): Check {
    const licensePath = join(homedir(), '.spidersan', 'license.json');
    if (existsSync(licensePath)) {
        return { name: 'Pro License', status: 'ok', message: 'License found' };
    }
    return { name: 'Pro License', status: 'warn', message: 'Free tier (5 branch limit)' };
}

async function checkStaleBranches(): Promise<Check> {
    try {
        const storage = await getStorage();
        if (!await storage.isInitialized()) {
            return { name: 'Stale Branches', status: 'warn', message: 'Storage not initialized' };
        }

        const branches = await storage.list();
        const stale = branches.filter(b => {
            const age = Date.now() - new Date(b.registeredAt).getTime();
            return age > 7 * 24 * 60 * 60 * 1000; // 7 days
        });

        if (stale.length > 0) {
            return { name: 'Stale Branches', status: 'warn', message: `${stale.length} branch(es) older than 7 days` };
        }
        return { name: 'Stale Branches', status: 'ok', message: 'No stale branches' };
    } catch {
        return { name: 'Stale Branches', status: 'error', message: 'Could not check' };
    }
}

function checkGitignore(): Check {
    const gitignorePath = join(process.cwd(), '.gitignore');
    if (!existsSync(gitignorePath)) {
        return { name: '.gitignore Check', status: 'warn', message: 'No .gitignore file found' };
    }

    try {
        const content = readFileSync(gitignorePath, 'utf-8');
        const missing: string[] = [];

        // Essential patterns that should be in .gitignore
        const essentialPatterns = [
            { pattern: '.env', description: 'env files' },
            { pattern: 'node_modules', description: 'node_modules' },
            { pattern: '*.key', description: 'key files' },
        ];

        for (const { pattern, description } of essentialPatterns) {
            // Check if pattern or similar is present
            const hasPattern = content.split('\n').some((line: string) => {
                const trimmed = line.trim();
                return !trimmed.startsWith('#') &&
                    (trimmed === pattern ||
                        trimmed.startsWith(pattern) ||
                        trimmed.includes(pattern));
            });
            if (!hasPattern) {
                missing.push(description);
            }
        }

        if (missing.length > 0) {
            return {
                name: '.gitignore Check',
                status: 'warn',
                message: `Missing patterns: ${missing.join(', ')}`
            };
        }
        return { name: '.gitignore Check', status: 'ok', message: 'Essential patterns present' };
    } catch {
        return { name: '.gitignore Check', status: 'error', message: 'Could not read .gitignore' };
    }
}

export const doctorCommand = new Command('doctor')
    .description('Diagnose common Spidersan issues')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const checks: Check[] = [
            checkGitContext(),
            checkLocalStorage(),
            checkGlobalStorage(),
            checkEnvConflict(),
            checkGitignore(),
            checkMycmail(),
            checkLicense(),
            await checkStaleBranches(),
        ];

        if (options.json) {
            console.log(JSON.stringify(checks, null, 2));
            return;
        }

        console.log('\n🕷️ Spidersan Doctor\n');

        const icons = { ok: '✅', warn: '⚠️ ', error: '❌' };

        for (const check of checks) {
            console.log(`  ${icons[check.status]} ${check.name}: ${check.message}`);
        }

        const errors = checks.filter(c => c.status === 'error').length;
        const warnings = checks.filter(c => c.status === 'warn').length;

        console.log('');
        if (errors > 0) {
            console.log(`  ❌ ${errors} error(s), ${warnings} warning(s)`);
            process.exit(1);
        } else if (warnings > 0) {
            console.log(`  ⚠️  ${warnings} warning(s), but no critical issues`);
        } else {
            console.log('  ✅ All checks passed!');
        }
        console.log('');
    });
