/**
 * spidersan who-touched <file>
 * 
 * Show git history of who touched a file, enriched with agent info.
 * Quick forensics for multi-agent coordination.
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

// Security: Input validation
const VALID_FILE_PATH = /^[a-zA-Z0-9._/-]+$/;

function validateFilePath(path: string): string {
    if (!VALID_FILE_PATH.test(path)) {
        throw new Error(`Invalid file path: "${path.slice(0, 50)}..."`);
    }
    return path;
}

interface TouchEntry {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: string;
    relativeDate: string;
    subject: string;
    agent?: string;
}

/**
 * Extract agent ID from commit message or author
 * Looks for patterns like:
 *   - 🕷️ Spidersan: ...
 *   - [mappersan] ...
 *   - Author email containing agent name
 */
function extractAgentFromCommit(entry: TouchEntry): string | undefined {
    const message = entry.subject.toLowerCase();
    const author = entry.author.toLowerCase();
    const email = entry.email.toLowerCase();

    // Known agent patterns in commit messages
    const agentPatterns = [
        /🕷️\s*(\w+san)/i,
        /🕵️\s*(\w+san)/i,
        /🗺️\s*(\w+san)/i,
        /🌊\s*(\w+san)/i,
        /🐦\s*(\w+san)/i,
        /🎨\s*(\w+san)/i,
        /📣\s*(\w+san)/i,
        /📿\s*(\w+san)/i,
        /🍄\s*(\w+san)/i,
        /🌳\s*(\w+san)/i,
        /🥷\s*(\w+san)/i,
        /\[(\w+san)\]/i,
        /^(\w+san):/i,
    ];

    for (const pattern of agentPatterns) {
        const match = message.match(pattern);
        if (match) return match[1].toLowerCase();
    }

    // Check author/email for agent names
    const knownAgents = [
        'spidersan', 'sherlocksan', 'mappersan', 'watsan', 'birdsan',
        'artisan', 'marksan', 'yosef', 'myceliumail', 'sasusan', 'treesan'
    ];

    for (const agent of knownAgents) {
        if (author.includes(agent) || email.includes(agent)) {
            return agent;
        }
    }

    return undefined;
}

function getAgentGlyph(agent: string): string {
    const glyphs: Record<string, string> = {
        'spidersan': '🕷️',
        'sherlocksan': '🕵️',
        'mappersan': '🗺️',
        'watsan': '🌊',
        'birdsan': '🐦',
        'artisan': '🎨',
        'marksan': '📣',
        'yosef': '📿',
        'myceliumail': '🍄',
        'sasusan': '🥷',
        'treesan': '🌳',
        'treebird': '🌳',
    };
    return glyphs[agent.toLowerCase()] || '👤';
}

function getFileHistory(filePath: string, limit: number): TouchEntry[] {
    try {
        // Use %x00 as delimiter for safety
        const format = '%H%x00%h%x00%an%x00%ae%x00%ai%x00%ar%x00%s';
        const output = execFileSync(
            'git',
            ['log', '-n', `${limit}`, '--follow', `--format=${format}`, '--', filePath],
            { encoding: 'utf-8', maxBuffer: 1024 * 1024 }
        );

        const entries: TouchEntry[] = [];
        const lines = output.trim().split('\n').filter(l => l);

        for (const line of lines) {
            const parts = line.split('\0');
            if (parts.length >= 7) {
                const entry: TouchEntry = {
                    hash: parts[0],
                    shortHash: parts[1],
                    author: parts[2],
                    email: parts[3],
                    date: parts[4],
                    relativeDate: parts[5],
                    subject: parts[6],
                };
                entry.agent = extractAgentFromCommit(entry);
                entries.push(entry);
            }
        }

        return entries;
    } catch (error) {
        throw new Error(`Failed to get git history for "${filePath}"`);
    }
}

function parseSinceDate(since: string): number | null {
    try {
        const output = execFileSync('date', ['-d', since, '+%s'], { encoding: 'utf-8' }).trim();
        return parseInt(output, 10);
    } catch {
        // GNU date failed; try BSD date format (macOS)
    }

    try {
        const output = execFileSync('date', ['-j', '-f', '%Y-%m-%d', since, '+%s'], { encoding: 'utf-8' }).trim();
        return parseInt(output, 10);
    } catch {
        return null;
    }
}

export const whoTouchedCommand = new Command('who-touched')
    .description('Show who touched a file (git history with agent detection)')
    .argument('<file>', 'File path to check history for')
    .option('-n, --limit <count>', 'Number of commits to show', '10')
    .option('--json', 'Output as JSON')
    .option('--agents-only', 'Only show commits from detected agents')
    .option('--since <date>', 'Show commits since date (e.g., "2 days ago")')
    .action(async (file, options) => {
        // Validate input
        const safePath = validateFilePath(file);

        const limit = parseInt(options.limit, 10) || 10;

        // Check if file exists or is tracked
        if (!existsSync(safePath)) {
            try {
                execFileSync('git', ['ls-files', '--error-unmatch', safePath], {
                    encoding: 'utf-8',
                    stdio: 'pipe'
                });
            } catch {
                console.error(`❌ File not found: ${safePath}`);
                process.exit(1);
            }
        }

        let entries = getFileHistory(safePath, limit * 2); // Get extra to filter

        // Filter by --agents-only
        if (options.agentsOnly) {
            entries = entries.filter(e => e.agent);
        }

        // Filter by --since
        if (options.since) {
            const sinceTimestamp = parseSinceDate(options.since);
            if (sinceTimestamp !== null) {
                entries = entries.filter(e => {
                    const commitDate = new Date(e.date).getTime() / 1000;
                    return commitDate >= sinceTimestamp;
                });
            }
        }

        // Limit results
        entries = entries.slice(0, limit);

        if (entries.length === 0) {
            console.log(`🕷️ No history found for "${safePath}"`);
            return;
        }

        if (options.json) {
            console.log(JSON.stringify({ file: safePath, history: entries }, null, 2));
            return;
        }

        // Count unique authors/agents
        const authors = new Set(entries.map(e => e.author));
        const agents = new Set(entries.filter(e => e.agent).map(e => e.agent));

        console.log(`
🕷️ WHO TOUCHED: ${safePath}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

        for (const entry of entries) {
            const glyph = entry.agent ? getAgentGlyph(entry.agent) : '👤';
            const agentTag = entry.agent ? ` (${entry.agent})` : '';
            const subject = entry.subject.length > 50
                ? entry.subject.slice(0, 47) + '...'
                : entry.subject;

            console.log(`${glyph} ${entry.shortHash} | ${entry.relativeDate.padEnd(15)} | ${entry.author}${agentTag}`);
            console.log(`   └─ ${subject}`);
        }

        console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ${entries.length} commits | ${authors.size} authors | ${agents.size} agents detected
`);

        if (agents.size > 0) {
            const agentList = Array.from(agents).map(a => `${getAgentGlyph(a!)} ${a}`).join(' ');
            console.log(`🤖 Agents: ${agentList}`);
        }
    });
