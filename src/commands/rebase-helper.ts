import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

export const rebaseHelperCommand = new Command('rebase-helper')
    .description('Detect and help resolve local git rebase states (non-interactive guidance)')
    .option('--abort', 'Abort an in-progress rebase')
    .option('--continue', 'Attempt to continue rebase (will skip editor prompts where possible)')
    .action(async (options) => {
        const repoRoot = process.cwd();
        const rebaseMerge = join(repoRoot, '.git', 'rebase-merge');
        const rebaseApply = join(repoRoot, '.git', 'rebase-apply');

        const inMerge = existsSync(rebaseMerge) || existsSync(rebaseApply);
        if (!inMerge) {
            console.log('✅ No rebase in progress.');
            return;
        }

        console.log('⚠️ Rebase state detected in this repository.');
        console.log('Common fixes:');
        console.log('  - To abort: git rebase --abort');
        console.log('  - To continue: git rebase --continue');
        console.log('If an editor opens during these commands, close it (ESC :q! for vim, Ctrl+X for nano).');

        if (options.abort) {
            try {
                execSync('GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase --abort', { stdio: 'inherit' });
                console.log('✅ Rebase aborted successfully');
            } catch {
                console.error('❌ Failed to abort rebase non-interactively. Try aborting in your terminal.');
                process.exit(1);
            }
            return;
        }

        if (options.continue) {
            try {
                execSync('GIT_EDITOR=true GIT_SEQUENCE_EDITOR=true git rebase --continue', { stdio: 'inherit' });
                console.log('✅ Rebase continued (or completed).');
            } catch {
                console.error('❌ Failed to continue rebase non-interactively. Please resolve conflicts and run git rebase --continue');
                process.exit(1);
            }
            return;
        }
    });
