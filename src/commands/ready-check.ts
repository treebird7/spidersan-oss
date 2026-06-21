/**
 * spidersan ready-check
 * 
 * Verify branch is ready to merge (no WIP markers, no conflicts).
 * Uses .spidersanrc config for customizable patterns.
 */

import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { getStorage } from '../storage/index.js';
import { loadConfig, getWipPatterns } from '../lib/config.js';
import { getChangedFiles, getCurrentBranch } from '../lib/git.js';
import { activeBranches } from '../lib/reconcile.js';
import { Minimatch } from 'minimatch';

export function shouldExcludeFile(file: string, excludePatterns: Minimatch[]): boolean {
    return excludePatterns.some(pattern => pattern.match(file));
}

export const readyCheckCommand = new Command('ready-check')
    .description('Verify branch is ready to merge')
    .option('--strict', 'Warn on WIP markers (kept for compatibility, no longer blocks)')
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
            // Performance Optimization: Hoist RegExp creation outside the loop
            // Note: RegExp instances here do not use the global 'g' flag, so they are stateless
            // and safe to reuse across files and lines.
            const wipRegexes = getWipPatterns(config);

            // Performance Optimization: Compile minimatch patterns once outside the loop
            const compiledExcludePatterns = config.readyCheck.excludeFiles.map(p => new Minimatch(p));

            for (const file of changedFiles) {
                // Skip excluded files
                if (shouldExcludeFile(file, compiledExcludePatterns)) {
                    continue;
                }

                try {
                    const content = await readFile(file, 'utf-8');
                    const lines = content.split('\n');

                    lines.forEach((line, i) => {
                        for (const regex of wipRegexes) {
                            if (regex.test(line)) {
                                issues.push({
                                    type: 'wip',
                                    file,
                                    line: i + 1,
                                    pattern: regex.source,
                                });
                            }
                        }
                    });
                } catch {
                    // File might not exist (deleted)
                }
            }

            // Check for experimental patterns — hoist combined regex as pre-filter (PR#79)
            if (config.readyCheck.enableExperimentalDetection && config.readyCheck.experimentalPatterns.length > 0) {
                const combinedRegex = new RegExp(
                    config.readyCheck.experimentalPatterns.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
                );
                for (const file of changedFiles) {
                    if (!combinedRegex.test(file)) continue;
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

        // Check for conflicts — reconcile-on-read drops branches already merged
        // into trunk so a stale registry can't report a phantom conflict (tb-8sa.1).
        const allBranches = activeBranches(await storage.list());
        const conflicts: string[] = [];

        if (branch) {
            // Performance Optimization: Convert branch files to Set for O(1) lookup
            const branchFilesSet = new Set(branch.files);
            for (const other of allBranches) {
                if (other.name === branchName) continue;
                if (other.files.some(f => branchFilesSet.has(f))) {
                    conflicts.push(other.name);
                }
            }
        }

        const result = {
            branch: branchName,
            ready: conflicts.length === 0, // WIP markers are advisory only — don't block merges
            issues,
            conflicts,
            config: {
                wipDetection: config.readyCheck.enableWipDetection,
                patternsChecked: config.readyCheck.wipPatterns.length,
            },
        };

        if (options.json) {
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.ready ? 0 : 1); // only exits 1 on file conflicts
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
                console.log(`ℹ️  Found ${expIssues.length} experimental file(s) (advisory):\n`);
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
            if (issues.length > 0) {
                console.log('   (WIP/XXX/experimental markers above are advisory — not blocking)');
            }
        } else {
            console.log('❌ Branch is NOT ready to merge (file conflicts with other branches).');
            process.exit(1);
        }
    });
