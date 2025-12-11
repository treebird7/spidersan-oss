/**
 * spidersan ready-check
 * 
 * Verify branch is ready to merge (no WIP markers, no conflicts).
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { readFile } from 'fs/promises';
import { LocalStorage } from '../storage/index.js';

const DEFAULT_WIP_PATTERNS = ['TODO', 'FIXME', 'WIP', 'XXX', 'HACK', '@todo'];

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function getChangedFiles(): string[] {
    try {
        // Get files changed vs main branch
        const diff = execSync('git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~1', {
            encoding: 'utf-8'
        });
        return diff.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

export const readyCheckCommand = new Command('ready-check')
    .description('Verify branch is ready to merge')
    .option('--strict', 'Fail on any WIP markers')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
        const storage = new LocalStorage();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = getCurrentBranch();
        const branch = await storage.get(branchName);
        const changedFiles = getChangedFiles();

        const issues: Array<{ type: string; file: string; line?: number; pattern?: string }> = [];

        // Check for WIP markers in changed files
        for (const file of changedFiles) {
            try {
                const content = await readFile(file, 'utf-8');
                const lines = content.split('\n');

                lines.forEach((line, i) => {
                    for (const pattern of DEFAULT_WIP_PATTERNS) {
                        if (line.includes(pattern)) {
                            issues.push({
                                type: 'wip',
                                file,
                                line: i + 1,
                                pattern,
                            });
                        }
                    }
                });
            } catch {
                // File might not exist (deleted)
            }
        }

        // Check for conflicts
        const allBranches = await storage.list();
        const conflicts: string[] = [];

        if (branch) {
            for (const other of allBranches) {
                if (other.name === branchName) continue;
                if (other.files.some(f => branch.files.includes(f))) {
                    conflicts.push(other.name);
                }
            }
        }

        const result = {
            branch: branchName,
            ready: issues.length === 0 && conflicts.length === 0,
            issues,
            conflicts,
        };

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ready ? 0 : 1);
        }

        console.log(`🕷️ Ready Check: ${branchName}\n`);

        if (issues.length > 0) {
            console.log(`⚠️  Found ${issues.length} WIP marker(s):\n`);
            for (const issue of issues.slice(0, 10)) {
                console.log(`   ${issue.file}:${issue.line} - ${issue.pattern}`);
            }
            if (issues.length > 10) {
                console.log(`   ... and ${issues.length - 10} more`);
            }
            console.log('');
        }

        if (conflicts.length > 0) {
            console.log(`⚠️  File conflicts with: ${conflicts.join(', ')}\n`);
        }

        if (result.ready) {
            console.log('✅ Branch is ready to merge!');
        } else {
            console.log('❌ Branch is NOT ready to merge.');
            if (options.strict) {
                process.exit(1);
            }
        }
    });
