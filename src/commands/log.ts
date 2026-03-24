/**
 * spidersan log — Activity log viewer
 * Shows branch operation history from local JSONL or Supabase
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { queryActivityLog, ActivityQuery } from '../lib/activity.js';

const EVENT_ICONS: Record<string, string> = {
    register: '📋',
    merge: '✅',
    abandon: '🗑️',
    conflict_detected: '⚠️',
    sync: '🔄',
    cleanup: '🧹',
    ready_check_pass: '✔️',
    ready_check_fail: '❌',
    session_start: '🌅',
    session_end: '🌙',
};

export function logCommand(program: Command) {
    program
        .command('log')
        .description('Show branch operation history')
        .option('-b, --branch <name>', 'Filter by branch name')
        .option('-a, --agent <id>', 'Filter by agent')
        .option('-r, --repo <name>', 'Filter by repo')
        .option('-s, --since <duration>', 'Time range e.g. 24h, 7d, 30d', '24h')
        .option('-n, --limit <n>', 'Max records', '50')
        .option('--json', 'Output as JSON')
        .action(async (options: {
            branch?: string;
            agent?: string;
            repo?: string;
            since?: string;
            limit?: string;
            json?: boolean;
        }) => {
            try {
                const since = parseDuration(options.since || '24h');
                const query: ActivityQuery = {
                    branch: options.branch,
                    agent: options.agent,
                    repo: options.repo,
                    since,
                    limit: parseInt(options.limit || '50', 10),
                };

                const result = await queryActivityLog(query);

                if (options.json) {
                    console.log(JSON.stringify(result, null, 2));
                    return;
                }

                const { records, source } = result;

                console.log(chalk.cyan(`🕷️  Spidersan Activity Log`) + chalk.gray(` (${source})`));
                console.log(chalk.gray(`   Since: ${since.toISOString().split('T')[0]} — ${records.length} record(s)\n`));

                if (records.length === 0) {
                    console.log(chalk.yellow('No activity found for the given filters.'));
                    return;
                }

                for (const r of records) {
                    const icon = EVENT_ICONS[r.event] || '•';
                    const time = new Date(r.created_at).toLocaleString('en-GB', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                    });
                    const agent = r.agent ? chalk.magenta(`[${r.agent}]`) : '';
                    const branch = r.branch ? chalk.green(r.branch) : '';
                    const repo = r.repo ? chalk.gray(`${r.repo}/`) : '';
                    const detail = formatDetail(r.event, r.details);

                    console.log(
                        `${chalk.gray(time)} ${icon} ${agent} ${repo}${branch}` +
                        (detail ? chalk.gray(` — ${detail}`) : '')
                    );
                }

            } catch (err) {
                console.error(chalk.red(`❌ ${(err as Error).message}`));
                process.exit(1);
            }
        });
}

function parseDuration(s: string): Date {
    const now = Date.now();
    const match = s.match(/^(\d+)([hdwm])$/);
    if (!match) return new Date(now - 24 * 60 * 60 * 1000);
    const n = parseInt(match[1], 10);
    const unit = match[2];
    const ms = unit === 'h' ? n * 3600000
        : unit === 'd' ? n * 86400000
        : unit === 'w' ? n * 604800000
        : n * 2592000000;
    return new Date(now - ms);
}

function formatDetail(event: string, details: Record<string, unknown>): string {
    if (event === 'conflict_detected') {
        // details stores tier counts {tier3, tier2, tier1} — derive max tier
        const t3 = (details.tier3 as number | undefined) ?? 0;
        const t2 = (details.tier2 as number | undefined) ?? 0;
        const t1 = (details.tier1 as number | undefined) ?? 0;
        const maxTier = t3 > 0 ? 3 : t2 > 0 ? 2 : t1 > 0 ? 1 : (details.tier as number | undefined);
        const branches = (details.conflicting_branches as string[] | undefined)?.join(', ');
        return `TIER ${maxTier ?? '?'}${branches ? ` with ${branches}` : ''}`;
    }
    if (event === 'register' && details.description) return details.description as string;
    if (event === 'merge' && details.pr_number) return `PR #${details.pr_number}`;
    if (event === 'ready_check_fail' && details.blockers) {
        const b = details.blockers as string[];
        return b.slice(0, 2).join(', ') + (b.length > 2 ? '…' : '');
    }
    if (event === 'sync') {
        const orphans = details.orphans_removed as number | undefined;
        const synced = details.branches_synced as number | undefined;
        if (orphans !== undefined || synced !== undefined)
            return `${synced ?? 0} synced, ${orphans ?? 0} orphans removed`;
    }
    return '';
}
