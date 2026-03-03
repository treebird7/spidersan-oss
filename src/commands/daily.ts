/**
 * spidersan daily — Daily collab bridge (L2)
 * Filters treebird-internal daily entries for branch-relevant context.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { queryDaily, listDailyDates, todayStr, DailyEntry } from '../lib/daily-bridge.js';
import { getStorage } from '../storage/index.js';
import { queryActivityLog } from '../lib/activity.js';

const AGENT_COLORS: Record<string, (s: string) => string> = {
    treesan: chalk.green,
    birdsan: chalk.cyan,
    sherlocksan: chalk.red,
    mycsan: chalk.magenta,
    spidersan: chalk.yellow,
    codex: chalk.gray,
    teachersan: chalk.blue,
    artisan: chalk.blueBright,
    watsan: chalk.greenBright,
    nanoclaw: chalk.yellowBright,
};

function agentColor(id: string): (s: string) => string {
    for (const [key, fn] of Object.entries(AGENT_COLORS)) {
        if (id.includes(key)) return fn;
    }
    return chalk.white;
}

export function dailyCommand(program: Command) {
    program
        .command('daily')
        .description('Show branch-relevant entries from daily collab logs')
        .option('-b, --branch <name>', 'Filter entries mentioning this branch')
        .option('-d, --date <YYYY-MM-DD>', 'Specific date (default: today)')
        .option('-l, --lookback <days>', 'Days to scan back (default: 14)', '14')
        .option('-a, --agent <id>', 'Filter by agent (e.g. birdsan, ssan)')
        .option('--tldr', 'One-line-per-entry summary mode')
        .option('--context', 'Full context: activity log + daily entries for the branch')
        .option('--all', 'Show all entries, not just branch-relevant ones')
        .option('--dates', 'List available daily dates')
        .option('--json', 'Output as JSON')
        .action(async (options: {
            branch?: string;
            date?: string;
            lookback?: string;
            agent?: string;
            tldr?: boolean;
            context?: boolean;
            all?: boolean;
            dates?: boolean;
            json?: boolean;
        }) => {
            try {
                // List available dates
                if (options.dates) {
                    const dates = listDailyDates();
                    if (dates.length === 0) {
                        console.log(chalk.yellow('No daily files found. Check TREEBIRD_INTERNAL env var.'));
                        return;
                    }
                    dates.forEach(d => console.log(d));
                    return;
                }

                // Build search terms from branch name + registry
                const terms: string[] = [];

                if (options.branch) {
                    terms.push(options.branch);
                    // Also add shortened form e.g. "feat/my-thing" → "my-thing"
                    const short = options.branch.split('/').pop();
                    if (short && short !== options.branch) terms.push(short);
                } else if (!options.all) {
                    // Pull branch names from registry as implicit terms
                    try {
                        const storage = await getStorage();
                        const branches = await storage.list();
                        for (const b of branches) {
                            if (b.name && b.name !== 'main') {
                                terms.push(b.name);
                                const short = b.name.split('/').pop();
                                if (short) terms.push(short);
                            }
                        }
                    } catch { /* registry unavailable — proceed without */ }
                }

                const entries = queryDaily({
                    date: options.date,
                    lookback: parseInt(options.lookback || '14', 10),
                    terms,
                    agents: options.agent ? [options.agent] : [],
                    requireMatch: !options.all,
                });

                if (options.json) {
                    console.log(JSON.stringify(entries, null, 2));
                    return;
                }

                const targetDate = options.date || (options.lookback === '1' ? todayStr() : null);
                const header = options.branch
                    ? `Daily context for ${chalk.green(options.branch)}`
                    : targetDate
                        ? `Daily — ${targetDate}`
                        : `Daily collab (last ${options.lookback || 14} days)`;

                console.log(chalk.cyan(`🕷️  ${header}`) + chalk.gray(` — ${entries.length} entry(s)\n`));

                if (entries.length === 0) {
                    console.log(chalk.yellow('No matching entries found.'));
                    console.log(chalk.gray('  Try: spidersan daily --all --date 2026-03-03'));
                    console.log(chalk.gray('  Or:  spidersan daily --dates'));
                    return;
                }

                // Context mode: show activity log + daily entries side by side
                if (options.context && options.branch) {
                    await showContext(options.branch, entries);
                    return;
                }

                displayEntries(entries, options.tldr || false);

            } catch (err) {
                console.error(chalk.red(`❌ ${(err as Error).message}`));
                process.exit(1);
            }
        });
}

function displayEntries(entries: DailyEntry[], tldr: boolean) {
    let lastDate = '';

    for (const entry of entries) {
        // Date separator
        if (entry.date !== lastDate) {
            if (lastDate) console.log('');
            console.log(chalk.bold.underline(entry.date));
            lastDate = entry.date;
        }

        const color = agentColor(entry.agentId);
        const timeStr = chalk.gray(entry.time.padEnd(8));
        const agentStr = color(`[${entry.agentId}]`);
        const matchStr = entry.matchedTerms.length > 0
            ? chalk.gray(` (${entry.matchedTerms.slice(0, 3).join(', ')})`)
            : '';

        if (tldr) {
            console.log(`${timeStr} ${agentStr} ${entry.excerpt}${matchStr}`);
        } else {
            console.log(`${timeStr} ${agentStr}${matchStr}`);
            // Word-wrap content at 100 chars
            const wrapped = entry.content
                .replace(/\*\*/g, '')
                .replace(/`([^`]+)`/g, chalk.yellow('$1'))
                .match(/.{1,100}(\s|$)/g)
                ?.join('\n   ') ?? entry.content;
            console.log(`   ${wrapped}`);
            console.log('');
        }
    }
}

async function showContext(branch: string, dailyEntries: DailyEntry[]) {
    console.log(chalk.bold(`📋 Activity Log — ${branch}\n`));

    try {
        const logResult = await queryActivityLog({ branch, limit: 20 });
        if (logResult.records.length > 0) {
            for (const r of logResult.records) {
                const time = new Date(r.created_at).toLocaleString('en-GB', {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                });
                const agent = r.agent ? chalk.magenta(`[${r.agent}]`) : '';
                console.log(`  ${chalk.gray(time)} ${agent} ${r.event}`);
            }
        } else {
            console.log(chalk.gray('  No activity log entries for this branch.'));
        }
    } catch {
        console.log(chalk.gray('  (activity log unavailable)'));
    }

    console.log('');
    console.log(chalk.bold(`📅 Daily Collab Mentions\n`));
    displayEntries(dailyEntries, false);
}
