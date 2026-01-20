/**
 * Collab Command - Join birdsan collaborative documents
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

function addAgentSection(filepath: string, agentName: string, agentId: string, message: string): void {
    let content = fs.readFileSync(filepath, 'utf-8');

    const now = new Date();
    const timestamp = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });

    const placeholder = '### [Agent responses will appear here]';
    const agentSection = `### ${agentName} (${agentId}) - ${date} ${timestamp}
${message}

---

${placeholder}`;

    if (content.includes(placeholder)) {
        content = content.replace(placeholder, agentSection);
    } else {
        content += `\n\n---\n\n### ${agentName} (${agentId}) - ${date} ${timestamp}\n${message}\n`;
    }

    const uncheckedPatterns = [
        new RegExp(`- \\[ \\] \\*\\*${agentName}\\*\\* - Awaiting response`),
        new RegExp(`- \\[ \\] \\*\\*${agentId}\\*\\* - Awaiting response`),
    ];

    for (const pattern of uncheckedPatterns) {
        content = content.replace(pattern, `- [x] **${agentName}** - Joined`);
    }

    fs.writeFileSync(filepath, content);
}

export function registerCollabCommand(program: Command): void {
    program
        .command('collab')
        .description('Join or manage collaborative documents')
        .option('--join <filepath>', 'Join an existing collaboration document')
        .option('-m, --message <message>', 'Custom message to add when joining')
        .action(async (options) => {
            const agentId = 'ssan';
            const agentName = 'Spidersan';

            if (options.join) {
                const filepath = options.join;

                if (!fs.existsSync(filepath)) {
                    console.error(`\n❌ Collab file not found: ${filepath}\n`);
                    process.exit(1);
                }

                console.log('\n🕷️  Joining Collaboration\n');
                console.log('─'.repeat(40));
                console.log(`File: ${path.basename(filepath)}`);

                const defaultMessage = `🕷️ Spidersan joining the web!

Feeling the threads from this discussion...

**Branch/Registry perspective:**
- Tracking collab participants like branch contributors
- Can detect tensions/conflicts in the discussion
- Monitoring for stale threads

Ready to weave!`;

                const message = options.message || defaultMessage;

                try {
                    addAgentSection(filepath, agentName, agentId, message);
                    console.log(`\n✓ ${agentName} joined the collab!`);
                    console.log(`  Added response to: ${filepath}`);

                    try {
                        const { spawnSync } = await import('child_process');
                        // Security: Use spawnSync with argument array instead of string interpolation
                        const safeFilename = path.basename(filepath).replace(/[^a-zA-Z0-9._-]/g, '_');
                        spawnSync('mycmail', ['send', 'bsan', 'Joined collab', '--message', `Spidersan joined: ${safeFilename}`, '-p'], {
                            stdio: 'ignore'
                        });
                        console.log('✓ Notified birdsan');
                    } catch {
                        // Ignore
                    }

                } catch (error) {
                    console.error(`\n❌ Failed to join: ${(error as Error).message}\n`);
                    process.exit(1);
                }

                console.log('\n' + '─'.repeat(40) + '\n');
            } else {
                console.log('\n🕷️  Spidersan Collab\n');
                console.log('─'.repeat(40));
                console.log(`
Usage:
  spidersan collab --join <filepath>  Join a collaboration
  
Options:
  --join <filepath>    Path to the collab document
  -m, --message <msg>  Custom message to add

Examples:
  spidersan collab --join ./collab/COLLAB_topic.md
`);
                console.log('─'.repeat(40) + '\n');
            }
        });
}
