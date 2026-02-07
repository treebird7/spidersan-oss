/**
 * spidersan ready-check
 * 
 * Verify branch is ready to merge (no WIP markers, no conflicts).
 * Uses .spidersanrc config for customizable patterns.
 */

import { Command } from 'commander';
import { execSync } from 'child_process';
import { readFile } from 'fs/promises';
import { getStorage } from '../storage/index.js';
import { loadConfig } from '../lib/config.js';
import { minimatch } from 'minimatch';

function getCurrentBranch(): string {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function getChangedFiles(): string[] {
    try {
        const diff = execSync('git diff --name-only main...HEAD 2>/dev/null || git diff --name-only HEAD~1', {
            encoding: 'utf-8'
        });
        return diff.trim().split('\n').filter(Boolean);
    } catch {
        return [];
    }
}

function shouldExcludeFile(file: string, excludePatterns: string[]): boolean {
    return excludePatterns.some(pattern => minimatch(file, pattern));
}

export const readyCheckCommand = new Command('ready-check')
    .description('Verify branch is ready to merge')
    .option('--strict', 'Fail on any WIP markers')
    .option('--json', 'Output as JSON')
    .option('--skip-wip', 'Skip WIP detection')
    .action(async (options) => {
        const storage = await getStorage();
        const config = await loadConfig();

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const branchName = getCurrentBranch();
        const branch = await storage.get(branchName);
        const changedFiles = getChangedFiles();

        const issues: Array<{ type: string; file: string; line?: number; pattern?: string }> = [];

        // Check for WIP markers (if enabled and not skipped)
        if (config.readyCheck.enableWipDetection && !options.skipWip) {
            for (const file of changedFiles) {
                // Skip excluded files
                if (shouldExcludeFile(file, config.readyCheck.excludeFiles)) {
                    continue;
                }

                try {
                    const content = await readFile(file, 'utf-8');
                    const lines = content.split('\n');

                    lines.forEach((line, i) => {
                        for (const pattern of config.readyCheck.wipPatterns) {
                            // Case-insensitive match
                            if (line.toUpperCase().includes(pattern.toUpperCase())) {
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

            // Check for experimental patterns
            if (config.readyCheck.enableExperimentalDetection) {
                for (const file of changedFiles) {
                    for (const pattern of config.readyCheck.experimentalPatterns) {
                        if (file.includes(pattern)) {
                            issues.push({
                                type: 'experimental',
                                file,
                                pattern,
                            });
                        }
                    }
                }
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
            config: {
                wipDetection: config.readyCheck.enableWipDetection,
                patternsChecked: config.readyCheck.wipPatterns.length,
            },
        };

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ready ? 0 : 1);
        }

        console.log(`🕷️ Ready Check: ${branchName}\n`);

        if (issues.length > 0) {
            const wipIssues = issues.filter(i => i.type === 'wip');
            const expIssues = issues.filter(i => i.type === 'experimental');

            if (wipIssues.length > 0) {
                console.log(`⚠️  Found ${wipIssues.length} WIP marker(s):\n`);
                for (const issue of wipIssues.slice(0, 10)) {
                    console.log(`   ${issue.file}:${issue.line} - ${issue.pattern}`);
                }
                if (wipIssues.length > 10) {
                    console.log(`   ... and ${wipIssues.length - 10} more`);
                }
                console.log('');
            }

            if (expIssues.length > 0) {
                console.log(`⚠️  Found ${expIssues.length} experimental file(s):\n`);
                for (const issue of expIssues) {
                    console.log(`   ${issue.file}`);
                }
                console.log('');
            }
        }

        if (conflicts.length > 0) {
            console.log(`⚠️  File conflicts with: ${conflicts.join(', ')}\n`);
        }

        if (result.ready) {
            console.log('✅ Branch is ready to merge!');
        } else {
            console.log('❌ Branch is NOT ready to merge.');
            console.log('   Tip: Use --skip-wip to bypass WIP detection');
            if (options.strict) {
                process.exit(1);
            }
        }
    });
