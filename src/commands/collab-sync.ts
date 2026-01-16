/**
 * spidersan collab-sync
 * 
 * Sync daily collab files with git to prevent merge conflicts.
 * Designed for append-only collaboration documents.
 * 
 * FlockView Integration:
 *   - Use --json for API consumption
 *   - Call --pre on collab open
 *   - Call --post on collab save/close
 */

import { Command } from 'commander';
import { execSync } from 'child_process';

interface SyncOptions {
    pre?: boolean;
    post?: boolean;
    pattern?: string;
    agent?: string;
    dryRun?: boolean;
    force?: boolean;
    json?: boolean;
}

interface SyncResult {
    success: boolean;
    action: 'pre' | 'post' | 'none';
    branch: string;
    stashed?: boolean;
    pulled?: boolean;
    popped?: boolean;
    conflicts?: boolean;
    staged?: boolean;
    committed?: boolean;
    pushed?: boolean;
    files?: string[];
    error?: string;
}

function runGit(cmd: string, silent = false): string {
    try {
        return execSync(`git ${cmd}`, {
            encoding: 'utf-8',
            stdio: silent ? 'pipe' : 'inherit'
        }).trim();
    } catch (error: unknown) {
        if (error instanceof Error && 'stdout' in error) {
            return (error as { stdout: string }).stdout?.trim() || '';
        }
        throw error;
    }
}

function runGitSilent(cmd: string): { success: boolean; output: string } {
    try {
        const output = execSync(`git ${cmd}`, {
            encoding: 'utf-8',
            stdio: 'pipe'
        }).trim();
        return { success: true, output };
    } catch (error: unknown) {
        const output = error instanceof Error && 'stdout' in error
            ? (error as { stdout: string }).stdout?.trim() || ''
            : '';
        return { success: false, output };
    }
}

function hasUncommittedChanges(): boolean {
    const status = runGit('status --porcelain', true);
    return status.length > 0;
}

function hasConflicts(): boolean {
    const status = runGit('status --porcelain', true);
    return status.includes('UU ') || status.includes('AA ') || status.includes('DD ');
}

function getCurrentBranch(): string {
    return runGit('rev-parse --abbrev-ref HEAD', true);
}

function getAgentFromEnv(): string {
    return process.env.SPIDERSAN_AGENT ||
        process.env.MYCELIUMAIL_AGENT_ID ||
        'agent';
}

export const collabSyncCommand = new Command('collab-sync')
    .description('Sync collab files with git (prevents merge conflicts)')
    .option('--pre', 'Pre-edit: stash, pull, pop')
    .option('--post', 'Post-edit: add, commit, push')
    .option('--pattern <glob>', 'File pattern to sync', 'collab/*.md')
    .option('--agent <name>', 'Agent name for commit message')
    .option('--dry-run', 'Show what would happen without executing')
    .option('--force', 'Skip confirmation prompts')
    .option('--json', 'Output as JSON (for FlockView integration)')
    .addHelpText('after', `
Examples:
  $ spidersan collab-sync --pre          # Before editing collab
  $ spidersan collab-sync --post         # After editing collab
  $ spidersan collab-sync --pre --post   # Full sync cycle
  $ spidersan collab-sync --pre --json   # For FlockView API
  
Workflow:
  1. spidersan collab-sync --pre    # Pull latest, handle stash
  2. Edit collab/2026-01-16-daily.md
  3. spidersan collab-sync --post   # Commit and push

FlockView Integration:
  - Call --pre --json when opening a collab
  - Call --post --json when saving/closing
`)
    .action(async (options: SyncOptions) => {
        const pattern = options.pattern || 'collab/*.md';
        const agent = options.agent || getAgentFromEnv();
        const branch = getCurrentBranch();
        const isJson = options.json;

        const result: SyncResult = {
            success: true,
            action: 'none',
            branch
        };

        if (!options.pre && !options.post) {
            if (isJson) {
                console.log(JSON.stringify({ success: false, error: 'Specify --pre or --post' }));
            } else {
                console.log('🕷️ Specify --pre (before editing) or --post (after editing)');
                console.log('   Run: spidersan collab-sync --help');
            }
            return;
        }

        if (!isJson) {
            console.log(`\n🕷️ COLLAB SYNC — ${branch}\n`);
        }

        // PRE-EDIT: Pull latest changes
        if (options.pre) {
            result.action = 'pre';

            if (!isJson) console.log('📥 PRE-EDIT SYNC\n');

            const dirty = hasUncommittedChanges();
            result.stashed = false;
            result.pulled = false;
            result.popped = false;

            // Step 1: Stash if dirty
            if (dirty) {
                if (!isJson) console.log('  1. Stashing uncommitted changes...');
                if (!options.dryRun) {
                    const stashResult = runGitSilent('stash push -m "spidersan-collab-sync"');
                    result.stashed = stashResult.success;
                }
                if (!isJson) console.log('     ✅ Stashed');
            } else {
                if (!isJson) console.log('  1. Working tree clean, no stash needed');
            }

            // Step 2: Pull with rebase
            if (!isJson) console.log('  2. Pulling latest changes...');
            if (!options.dryRun) {
                const pullResult = runGitSilent('pull --rebase');
                result.pulled = pullResult.success;
                if (!isJson) {
                    console.log(pullResult.success ? '     ✅ Pulled' : '     ⚠️  Pull failed');
                }
            }

            // Step 3: Pop stash if we stashed
            if (dirty) {
                if (!isJson) console.log('  3. Restoring your changes...');
                if (!options.dryRun) {
                    const popResult = runGitSilent('stash pop');
                    result.popped = popResult.success;
                    if (!isJson) {
                        console.log(popResult.success ? '     ✅ Restored' : '     ⚠️  Stash pop failed');
                    }
                }
            }

            // Step 4: Check for conflicts
            if (!options.dryRun) {
                result.conflicts = hasConflicts();
                if (result.conflicts) {
                    result.success = false;
                    result.error = 'Conflicts detected';
                    if (!isJson) {
                        console.log('\n  🔴 CONFLICTS DETECTED');
                        console.log('     Resolve manually, then run: spidersan collab-sync --post');
                    }
                }
            }

            if (!isJson && result.success) {
                console.log('\n  ✅ Ready to edit collab files!\n');
            }
        }

        // POST-EDIT: Commit and push
        if (options.post) {
            result.action = options.pre ? 'post' : 'post'; // If both, last action is post

            if (!isJson) console.log('📤 POST-EDIT SYNC\n');

            result.staged = false;
            result.committed = false;
            result.pushed = false;

            // Step 1: Check for changes
            const status = runGit('status --porcelain', true);
            const collabChanges = status.split('\n').filter(line => {
                const file = line.substring(3);
                const patternBase = pattern.replace('*.md', '');
                return file.startsWith(patternBase) && file.endsWith('.md');
            });

            result.files = collabChanges.map(c => c.substring(3));

            if (collabChanges.length === 0) {
                if (!isJson) console.log('  No collab changes to sync.');
                if (isJson) console.log(JSON.stringify(result));
                return;
            }

            if (!isJson) {
                console.log(`  1. Found ${collabChanges.length} changed collab file(s):`);
                collabChanges.forEach(c => console.log(`     - ${c.substring(3)}`));
            }

            // Step 2: Add files
            if (!isJson) console.log(`  2. Staging ${pattern}...`);
            if (!options.dryRun) {
                const addResult = runGitSilent(`add ${pattern}`);
                result.staged = addResult.success;
                if (!isJson) console.log(addResult.success ? '     ✅ Staged' : '     ⚠️  Stage failed');
            }

            // Step 3: Commit
            const timestamp = new Date().toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const commitMsg = `collab(${agent}): entry at ${timestamp}`;

            if (!isJson) console.log(`  3. Committing: "${commitMsg}"`);
            if (!options.dryRun) {
                const commitResult = runGitSilent(`commit -m "${commitMsg}"`);
                result.committed = commitResult.success;
                if (!isJson) {
                    console.log(commitResult.success ? '     ✅ Committed' : '     ⚠️  Nothing to commit');
                }
            }

            // Step 4: Push
            if (!isJson) console.log('  4. Pushing to remote...');
            if (!options.dryRun) {
                const pushResult = runGitSilent('push');
                result.pushed = pushResult.success;
                if (!isJson) {
                    console.log(pushResult.success ? '     ✅ Pushed' : '     ⚠️  Push failed');
                }
            }

            if (!isJson) console.log('\n  ✅ Collab synced!\n');
        }

        if (options.dryRun && !isJson) {
            console.log('🔍 DRY RUN — no changes made\n');
        }

        if (isJson) {
            console.log(JSON.stringify(result, null, 2));
        }
    });
