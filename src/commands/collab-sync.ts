/**
 * spidersan collab-sync
 * 
 * Sync daily collab files with git to prevent merge conflicts.
 * Designed for append-only collaboration documents.
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
    .addHelpText('after', `
Examples:
  $ spidersan collab-sync --pre          # Before editing collab
  $ spidersan collab-sync --post         # After editing collab
  $ spidersan collab-sync --pre --post   # Full sync cycle
  
Workflow:
  1. spidersan collab-sync --pre    # Pull latest, handle stash
  2. Edit collab/2026-01-16-daily.md
  3. spidersan collab-sync --post   # Commit and push
`)
    .action(async (options: SyncOptions) => {
        const pattern = options.pattern || 'collab/*.md';
        const agent = options.agent || getAgentFromEnv();
        const branch = getCurrentBranch();

        if (!options.pre && !options.post) {
            console.log('🕷️ Specify --pre (before editing) or --post (after editing)');
            console.log('   Run: spidersan collab-sync --help');
            return;
        }

        console.log(`\n🕷️ COLLAB SYNC — ${branch}\n`);

        // PRE-EDIT: Pull latest changes
        if (options.pre) {
            console.log('📥 PRE-EDIT SYNC\n');

            const dirty = hasUncommittedChanges();

            // Step 1: Stash if dirty
            if (dirty) {
                console.log('  1. Stashing uncommitted changes...');
                if (!options.dryRun) {
                    runGit('stash push -m "spidersan-collab-sync"');
                }
                console.log('     ✅ Stashed');
            } else {
                console.log('  1. Working tree clean, no stash needed');
            }

            // Step 2: Pull with rebase
            console.log('  2. Pulling latest changes...');
            if (!options.dryRun) {
                try {
                    runGit('pull --rebase');
                    console.log('     ✅ Pulled');
                } catch {
                    console.log('     ⚠️  Pull failed (may be offline or conflicts)');
                }
            }

            // Step 3: Pop stash if we stashed
            if (dirty) {
                console.log('  3. Restoring your changes...');
                if (!options.dryRun) {
                    try {
                        runGit('stash pop');
                        console.log('     ✅ Restored');
                    } catch {
                        console.log('     ⚠️  Stash pop failed — you may have conflicts');
                        console.log('        Run: git stash show -p');
                    }
                }
            }

            // Step 4: Check for conflicts
            if (!options.dryRun && hasConflicts()) {
                console.log('\n  🔴 CONFLICTS DETECTED');
                console.log('     Resolve manually, then run: spidersan collab-sync --post');
                process.exit(1);
            }

            console.log('\n  ✅ Ready to edit collab files!\n');
        }

        // POST-EDIT: Commit and push
        if (options.post) {
            console.log('📤 POST-EDIT SYNC\n');

            // Step 1: Check for changes
            const status = runGit('status --porcelain', true);
            const collabChanges = status.split('\n').filter(line => {
                // Match the pattern (simplified glob matching)
                const file = line.substring(3);
                const patternBase = pattern.replace('*.md', '');
                return file.startsWith(patternBase) && file.endsWith('.md');
            });

            if (collabChanges.length === 0) {
                console.log('  No collab changes to sync.');
                return;
            }

            console.log(`  1. Found ${collabChanges.length} changed collab file(s):`);
            collabChanges.forEach(c => console.log(`     - ${c.substring(3)}`));

            // Step 2: Add files
            console.log(`  2. Staging ${pattern}...`);
            if (!options.dryRun) {
                runGit(`add ${pattern}`);
                console.log('     ✅ Staged');
            }

            // Step 3: Commit
            const timestamp = new Date().toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit'
            });
            const commitMsg = `collab(${agent}): entry at ${timestamp}`;

            console.log(`  3. Committing: "${commitMsg}"`);
            if (!options.dryRun) {
                try {
                    runGit(`commit -m "${commitMsg}"`);
                    console.log('     ✅ Committed');
                } catch {
                    console.log('     ⚠️  Nothing to commit (already committed?)');
                }
            }

            // Step 4: Push
            console.log('  4. Pushing to remote...');
            if (!options.dryRun) {
                try {
                    runGit('push');
                    console.log('     ✅ Pushed');
                } catch {
                    console.log('     ⚠️  Push failed — try: git push --force-with-lease');
                }
            }

            console.log('\n  ✅ Collab synced!\n');
        }

        if (options.dryRun) {
            console.log('🔍 DRY RUN — no changes made\n');
        }
    });
