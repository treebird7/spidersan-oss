/**
 * spidersan doctor
 * 
 * Diagnose common issues with Spidersan setup.
 */

import { Command } from 'commander';
import { existsSync, statSync } from 'fs';
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
        // Check if it might conflict with mycmail/supabase
        try {
            const content = require('fs').readFileSync(localEnv, 'utf-8');
            if (content.includes('SUPABASE_URL') || content.includes('SUPABASE_KEY')) {
                return {
                    name: '.env Conflict',
                    status: 'warn',
                    message: 'Local .env has Supabase vars - may conflict with mycmail'
                };
            }
        } catch {
            // Ignore read errors
        }
    }
    return { name: '.env Conflict', status: 'ok', message: 'No conflicting .env detected' };
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

export const doctorCommand = new Command('doctor')
    .description('Diagnose common Spidersan issues')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const checks: Check[] = [
            checkGitContext(),
            checkLocalStorage(),
            checkGlobalStorage(),
            checkEnvConflict(),
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
