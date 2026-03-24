/**
 * spidersan sync-advisor
 *
 * Scan all repos and recommend push/pull/cleanup actions.
 *
 * Usage:
 *   spidersan sync-advisor
 *   spidersan sync-advisor --dir ~/Dev
 *   spidersan sync-advisor --repo /path/to/repo
 *   spidersan sync-advisor --json
 */

import { Command } from 'commander';
import { homedir } from 'os';
import { join } from 'path';
import { scanAllRepos, scanRepo, generateRecommendations } from '../lib/repo-scanner.js';
import type { SyncRecommendation } from '../types/cloud.js';

const ICON: Record<string, string> = {
    push: '🔴',
    pull: '🟠',
    rebase: '🟡',
    conflict: '⚪',
    'up-to-date': '✅',
};

const ACTION_LABEL: Record<string, string> = {
    push: 'PUSH',
    pull: 'PULL',
    rebase: 'REBASE',
    conflict: 'DIRTY',
    'up-to-date': 'OK',
};

function expandPath(p: string): string {
    return p.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

function formatRow(rec: SyncRecommendation): string {
    const icon = ICON[rec.action] || '❓';
    const action = ACTION_LABEL[rec.action] || rec.action.toUpperCase();
    return `${icon} ${rec.repo_name.padEnd(20)} ${rec.branch_name.padEnd(25)} ${action.padEnd(8)} ${rec.reason}`;
}

function groupByAction(recs: SyncRecommendation[]): Record<string, SyncRecommendation[]> {
    const groups: Record<string, SyncRecommendation[]> = {
        push: [], pull: [], rebase: [], conflict: [], 'up-to-date': [],
    };
    for (const rec of recs) {
        (groups[rec.action] ??= []).push(rec);
    }
    return groups;
}

function formatTable(recs: SyncRecommendation[]): string {
    const g = groupByAction(recs);
    const lines: string[] = [];

    const sections: Array<[string, string]> = [
        ['push', '🔴 PUSH NEEDED'],
        ['pull', '🟠 PULL NEEDED'],
        ['rebase', '🟡 REBASE NEEDED'],
        ['conflict', '⚪ DIRTY ONLY'],
    ];

    for (const [key, label] of sections) {
        if (g[key].length > 0) {
            lines.push('', `${label} (${g[key].length}):`);
            for (const rec of g[key]) lines.push(`  ${formatRow(rec)}`);
        }
    }

    if (g['up-to-date'].length > 0) {
        lines.push('', `✅ SYNCED (${g['up-to-date'].length}):`);
        lines.push(`  ${g['up-to-date'].map(r => r.repo_name).join(', ')}`);
    }

    lines.push('', `Summary: ${g.push.length} push, ${g.pull.length} pull, ` +
        `${g.rebase.length} rebase, ${g.conflict.length} dirty, ${g['up-to-date'].length} clean`);

    return lines.join('\n');
}

export function syncAdvisorCommand(): Command {
    return new Command('sync-advisor')
        .description('Scan repositories and recommend push/pull/cleanup actions')
        .option('--dir <path>', 'Base directory to scan (default: ~/Dev)', join(homedir(), 'Dev'))
        .option('--repo <path>', 'Scan a single repository')
        .option('--json', 'Output as JSON')
        .action(async (options) => {
            try {
                const dir = expandPath(options.dir);
                let recommendations: SyncRecommendation[] = [];

                if (options.repo) {
                    const repoPath = expandPath(options.repo);
                    const state = scanRepo(repoPath);
                    if (!state) {
                        console.error(`❌ Not a git repository: ${repoPath}`);
                        process.exit(1);
                    }
                    recommendations = generateRecommendations([state]);
                } else {
                    console.log(`\n🕷️ Sync Advisor — scanning ${dir}`);
                    const states = scanAllRepos(dir);
                    recommendations = generateRecommendations(states);
                    console.log(`Found ${states.length} repositories\n`);
                }

                if (options.json) {
                    console.log(JSON.stringify(recommendations, null, 2));
                } else {
                    console.log(formatTable(recommendations));
                    console.log('');
                }
            } catch (error) {
                console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
                process.exit(1);
            }
        });
}
