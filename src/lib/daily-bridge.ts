/**
 * Daily Bridge — L2
 * Reads treebird-internal daily collab files and filters for branch-relevant entries.
 * Read-only: never writes to collab (toak owns writes).
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DailyEntry {
    date: string;         // YYYY-MM-DD
    time: string;         // from table cell or 'unknown'
    agent: string;        // raw agent cell text
    agentId: string;      // normalised lowercase id e.g. 'birdsan', 'ssan'
    content: string;      // full entry text
    excerpt: string;      // first ~120 chars
    matchedTerms: string[]; // which search terms matched
}

export interface DailyBridgeOptions {
    /** Path to daily collab directory. Defaults to TREEBIRD_DAILY or ~/Dev/treebird-internal/collab/daily */
    dailyDir?: string;
    /** Only parse this specific date (YYYY-MM-DD) */
    date?: string;
    /** How many days back to scan (default 14) */
    lookback?: number;
    /** Extra terms to match (branch names, file paths, etc.) */
    terms?: string[];
    /** Agent IDs to filter by */
    agents?: string[];
    /** If true, only return entries that matched at least one term */
    requireMatch?: boolean;
}

const BRANCH_KEYWORDS = [
    'merge', 'cherry-pick', 'cherry pick', 'rebase', 'conflict',
    'branch', 'abandon', 'stale', 'pr', 'pull request', 'push', 'worktree',
    'tidy', 'cleanup', 'register',
];

const DAILY_FILE_REGEX = /^\d{4}-\d{2}-\d{2}-daily\.md$/;

const AGENT_EMOJI_MAP: Record<string, string> = {
    '🌳': 'treesan',
    '🐦': 'birdsan',
    '🔍': 'sherlocksan',
    '🍄': 'mycsan',
    '🕷️': 'spidersan',
    '🤖': 'codex',
    '📚': 'teachersan',
    '🗺️': 'mappersan',
    '🌊': 'watsan',
    '🦅': 'artisan',
    '🐛': 'birdsan',
    '💎': 'nanoclaw',
};

function getDailyDir(): string {
    if (process.env.TREEBIRD_DAILY) return process.env.TREEBIRD_DAILY;
    const internal = process.env.TREEBIRD_INTERNAL
        || join(homedir(), 'Dev', 'treebird-internal');
    return join(internal, 'collab', 'daily');
}

function normaliseAgent(raw: string): string {
    // Try emoji map first
    for (const [emoji, id] of Object.entries(AGENT_EMOJI_MAP)) {
        if (raw.includes(emoji)) return id;
    }
    // Strip emoji + trim
    return raw.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim().toLowerCase();
}

// Known non-entry table headers (Start/Stop/Continue, etc.)
const NON_ENTRY_HEADERS = new Set(['start', 'stop', 'continue', 'time', 'agent', 'entry', 'summary', 'what', 'when', 'why', 'branch', 'status', 'repo', 'owner', 'blockedby', '#']);

function looksLikeTimeOrAgent(s: string): boolean {
    // Time-like: HH:MM, "dawn", "today", "morning", "closing", "late", "evening", "--", "session", "afternoon"
    if (/^\d{2}:\d{2}/.test(s)) return true;
    if (/^(dawn|today|morning|closing|late|evening|afternoon|session|--|\d+:\d+|`\d+:\d+`)$/i.test(s)) return true;
    // Agent-like: contains emoji or known agent name
    if (/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(s)) return true;
    if (/\b(treesan|birdsan|sherlocksan|mycsan|spidersan|codex|artisan|watsan|nanoclaw|sasusan|mappersan|teachersan|copilot)\b/i.test(s)) return true;
    return false;
}

function parseTableEntries(content: string, date: string): DailyEntry[] {
    const entries: DailyEntry[] = [];
    const lines = content.split('\n');

    for (const line of lines) {
        // Match 3-column table rows: | col1 | col2 | col3 |
        const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|?\s*$/);
        if (!m) continue;

        const time = m[1].trim();
        const agentRaw = m[2].trim();
        const entryContent = m[3].trim();

        // Skip separator rows
        if (time === '---' || agentRaw === '---' || entryContent === '---') continue;

        // Skip known non-entry table headers
        if (NON_ENTRY_HEADERS.has(time.toLowerCase()) && NON_ENTRY_HEADERS.has(agentRaw.toLowerCase())) continue;

        // Must look like a time/agent pattern
        if (!looksLikeTimeOrAgent(time) && !looksLikeTimeOrAgent(agentRaw)) continue;

        // Content must be substantial (>20 chars) to be a real entry
        if (!entryContent || entryContent.length < 20) continue;

        const agentId = normaliseAgent(agentRaw);
        const excerpt = entryContent.replace(/\*\*/g, '').slice(0, 120) + (entryContent.length > 120 ? '…' : '');

        entries.push({
            date,
            time,
            agent: agentRaw,
            agentId,
            content: entryContent,
            excerpt,
            matchedTerms: [],
        });
    }

    return entries;
}

function scoreEntry(entry: DailyEntry, terms: string[], _agents: string[]): string[] {
    const text = entry.content.toLowerCase();
    const matched: string[] = [];

    for (const term of terms) {
        if (text.includes(term.toLowerCase())) {
            matched.push(term);
        }
    }

    // Always match branch keywords
    for (const kw of BRANCH_KEYWORDS) {
        if (text.includes(kw) && !matched.includes(kw)) {
            matched.push(kw);
        }
    }

    return matched;
}

function listDailyFiles(dailyDir: string, lookback: number): Array<{ date: string; path: string }> {
    if (!existsSync(dailyDir)) return [];

    const files = readdirSync(dailyDir)
        .filter(f => DAILY_FILE_REGEX.test(f))
        .sort()
        .reverse();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookback);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    return files
        .map(f => ({ date: f.slice(0, 10), path: join(dailyDir, f) }))
        .filter(f => f.date >= cutoffStr);
}

/**
 * Query daily collab files for branch-relevant entries.
 */
export function queryDaily(options: DailyBridgeOptions = {}): DailyEntry[] {
    const dailyDir = options.dailyDir || getDailyDir();
    const lookback = options.lookback ?? 14;
    const requireMatch = options.requireMatch ?? true;
    const terms = options.terms ?? [];
    const agents = options.agents ?? [];

    let files: Array<{ date: string; path: string }>;

    if (options.date) {
        const p = join(dailyDir, `${options.date}-daily.md`);
        files = existsSync(p) ? [{ date: options.date, path: p }] : [];
    } else {
        files = listDailyFiles(dailyDir, lookback);
    }

    const results: DailyEntry[] = [];

    for (const { date, path } of files) {
        let content: string;
        try {
            content = readFileSync(path, 'utf-8');
        } catch {
            continue;
        }

        const entries = parseTableEntries(content, date);

        for (const entry of entries) {
            // Agent filter
            if (agents.length > 0 && !agents.some(a => entry.agentId.includes(a.toLowerCase()))) {
                continue;
            }

            entry.matchedTerms = scoreEntry(entry, terms, agents);

            if (requireMatch && entry.matchedTerms.length === 0) continue;

            results.push(entry);
        }
    }

    return results;
}

/**
 * Get today's date string YYYY-MM-DD
 */
export function todayStr(): string {
    return new Date().toISOString().split('T')[0];
}

/**
 * List all available daily dates (newest first)
 */
export function listDailyDates(dailyDir?: string): string[] {
    const dir = dailyDir || getDailyDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
        .filter(f => DAILY_FILE_REGEX.test(f))
        .map(f => f.slice(0, 10))
        .sort()
        .reverse();
}
