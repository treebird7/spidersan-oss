import { Command } from 'commander';
import { execa } from 'execa';
import fs from 'fs';
import path from 'path';

export const whoOwnsCommand = new Command('who-owns')
    .description('Identify the owner of a file or directory based on git history')
    .argument('[path]', 'Path to check', '.')
    .option('-l, --limit <number>', 'Number of top contributors to show', '5')
    .option('--json', 'Output as JSON')
    .action(async (targetPath, options) => {
        const absolutePath = path.resolve(process.cwd(), targetPath);

        if (!fs.existsSync(absolutePath)) {
            console.error(`❌ Path not found: ${targetPath}`);
            process.exit(1);
        }

        const isDirectory = fs.statSync(absolutePath).isDirectory();

        const gitCwd = isDirectory ? absolutePath : path.dirname(absolutePath);

        try {
            // Get last modified by
            const { stdout: lastAuthor } = await execa('git', [
                'log', '-1', '--format=%an <%ae> (%cr)', isDirectory ? '.' : path.basename(absolutePath)
            ], { cwd: gitCwd });

            // Get top contributors
            const { stdout: contributors } = await execa('git', [
                'shortlog', '-sn', '--no-merges', '--', isDirectory ? '.' : path.basename(absolutePath)
            ], { cwd: gitCwd });

            const topContributors = contributors
                .split('\n')
                .filter(Boolean)
                .map(line => {
                    const [count, ...nameParts] = line.trim().split('\t');
                    return { count: parseInt(count), name: nameParts.join('\t') };
                })
                .slice(0, parseInt(options.limit));

            if (options.json) {
                console.log(JSON.stringify({
                    path: targetPath,
                    type: isDirectory ? 'directory' : 'file',
                    lastModifiedBy: lastAuthor,
                    topContributors
                }, null, 2));
                return;
            }

            console.log(`\n🔍 Ownership Report: ${targetPath}\n`);
            console.log(`  📂 Type: ${isDirectory ? 'Directory' : 'File'}`);
            console.log(`  ✍️  Last Modified: ${lastAuthor || 'Unknown'}\n`);

            console.log(`  🏆 Top Contributors:`);
            if (topContributors.length === 0) {
                console.log('     No git history found.');
            } else {
                topContributors.forEach((c, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '  ';
                    console.log(`    ${medal} ${c.count.toString().padEnd(5)} ${c.name}`);
                });
            }
            console.log('');

        } catch (error: any) {
            console.error(`❌ Failed to check ownership: ${error.message}`);
            // Check if it's a git repo
            if (error.message.includes('not a git repository')) {
                console.error('    Current directory is not a git repository.');
            }
            process.exit(1);
        }
    });
