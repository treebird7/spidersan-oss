/**
 * spidersan intent-scan
 * 
 * Layer 3: Intent Conflict Detection
 * 
 * Parses collab entries to detect overlapping work intentions
 * BEFORE agents start coding. Prevents duplicate work like
 * the formation incident.
 * 
 * Usage:
 *   spidersan intent-scan              # Scan today's collab
 *   spidersan intent-scan --days 3     # Scan last 3 days
 *   spidersan intent-scan --watch      # Watch for new intents
 */

import { Command } from 'commander';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

// Intent signal extracted from collab entry
interface IntentSignal {
    agent: string;
    timestamp: string;
    rawEntry: string;
    intent: string;     // Extracted action + object
    keywords: string[];
    status: 'planning' | 'starting' | 'implementing' | 'complete' | 'unknown';
    file: string;
    lineNumber: number;
}

// Overlap detection result
interface IntentOverlap {
    intent1: IntentSignal;
    intent2: IntentSignal;
    overlapScore: number;  // 0-100
    sharedKeywords: string[];
    severity: 'info' | 'warn' | 'conflict';
}

// Keywords that indicate work intent
const INTENT_VERBS = [
    'building', 'implementing', 'creating', 'adding', 'developing',
    'starting', 'working on', 'claiming', 'taking', 'picking up',
    'coding', 'writing', 'designing', 'planning', 'shipping'
];

// Keywords that indicate completion
const COMPLETION_VERBS = [
    'shipped', 'completed', 'finished', 'done', 'merged', 'pushed'
];

// High-value keywords to track
const PROJECT_KEYWORDS = [
    'formation', 'invoak', 'swarmsan', 'treesan', 'spidersan',
    'flockview', 'treesync', 'mycmail', 'myceliumail', 'watsan',
    'sancho', 'birdsan', 'sherlocksan', 'envoak', 'mappersan',
    'mvp', 'cli', 'mcp', 'worker', 'pool', 'task', 'sync',
    'hybrid', 'search', 'rag', 'kg', 'digest', 'status'
];

// Agent emoji patterns
const AGENT_PATTERNS: Record<string, string> = {
    '🐦': 'Birdsan',
    '🕷️': 'Spidersan',
    '🔍': 'Sherlocksan',
    '🌵': 'Sancho',
    '📣': 'Marksan',
    '🗺️': 'Mappersan',
    '🍄': 'Myceliumail',
    '📚': 'Watsan',
    '🧪': 'Yosef',
    '🎨': 'Artisan',
    '🌑': 'Sasusan',
    '🌲': 'Treesan'
};

function parseAgentEntry(line: string): { agent: string; time: string } | null {
    // Pattern: ## 🐦 Birdsan — 21:10 (optional context)
    const match = line.match(/^##\s+([\p{Emoji}]+)\s+(\w+)\s*[—-]\s*(\d{1,2}:\d{2})/u);
    if (match) {
        return { agent: match[2], time: match[3] };
    }
    return null;
}

function extractStatus(text: string): IntentSignal['status'] {
    const lower = text.toLowerCase();
    if (COMPLETION_VERBS.some(v => lower.includes(v))) return 'complete';
    if (lower.includes('starting') || lower.includes('claiming')) return 'starting';
    if (lower.includes('implementing') || lower.includes('building')) return 'implementing';
    if (lower.includes('planning') || lower.includes('proposing')) return 'planning';
    return 'unknown';
}

function extractKeywords(text: string): string[] {
    const lower = text.toLowerCase();
    return PROJECT_KEYWORDS.filter(kw => lower.includes(kw));
}

function extractIntent(text: string): string {
    const lower = text.toLowerCase();

    // Look for intent patterns
    for (const verb of INTENT_VERBS) {
        const idx = lower.indexOf(verb);
        if (idx !== -1) {
            // Extract up to 50 chars after verb
            const start = idx;
            const end = Math.min(idx + 60, text.length);
            const snippet = text.substring(start, end).split('\n')[0];
            return snippet.trim();
        }
    }

    // Fallback: first line with keywords
    const lines = text.split('\n');
    for (const line of lines) {
        if (extractKeywords(line).length > 0) {
            return line.trim().substring(0, 80);
        }
    }

    return '';
}

function parseCollabFile(filePath: string): IntentSignal[] {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const intents: IntentSignal[] = [];

    let currentAgent: string | null = null;
    let currentTime: string | null = null;
    let entryStart = 0;
    let entryLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const agentMatch = parseAgentEntry(line);

        if (agentMatch) {
            // Save previous entry if exists
            if (currentAgent && entryLines.length > 0) {
                const entryText = entryLines.join('\n');
                const intent = extractIntent(entryText);
                const keywords = extractKeywords(entryText);
                const status = extractStatus(entryText);

                // Only record if intent detected
                if (intent || keywords.length > 0) {
                    intents.push({
                        agent: currentAgent,
                        timestamp: currentTime!,
                        rawEntry: entryText.substring(0, 500),
                        intent,
                        keywords,
                        status,
                        file: filePath,
                        lineNumber: entryStart
                    });
                }
            }

            // Start new entry
            currentAgent = agentMatch.agent;
            currentTime = agentMatch.time;
            entryStart = i + 1;
            entryLines = [];
        } else if (currentAgent) {
            entryLines.push(line);
        }
    }

    // Don't forget last entry
    if (currentAgent && entryLines.length > 0) {
        const entryText = entryLines.join('\n');
        const intent = extractIntent(entryText);
        const keywords = extractKeywords(entryText);
        const status = extractStatus(entryText);

        if (intent || keywords.length > 0) {
            intents.push({
                agent: currentAgent,
                timestamp: currentTime!,
                rawEntry: entryText.substring(0, 500),
                intent,
                keywords,
                status,
                file: filePath,
                lineNumber: entryStart
            });
        }
    }

    return intents;
}

function calculateOverlap(a: IntentSignal, b: IntentSignal): IntentOverlap | null {
    // Same agent can't conflict with themselves
    if (a.agent === b.agent) return null;

    // Completed work doesn't conflict
    if (a.status === 'complete' || b.status === 'complete') return null;

    // Find shared keywords
    const sharedKeywords = a.keywords.filter(k => b.keywords.includes(k));

    if (sharedKeywords.length === 0) return null;

    // Calculate overlap score
    const totalKeywords = new Set([...a.keywords, ...b.keywords]).size;
    const overlapScore = Math.round((sharedKeywords.length / totalKeywords) * 100);

    // Determine severity
    let severity: IntentOverlap['severity'] = 'info';
    if (overlapScore >= 70) severity = 'conflict';
    else if (overlapScore >= 40) severity = 'warn';

    return {
        intent1: a,
        intent2: b,
        overlapScore,
        sharedKeywords,
        severity
    };
}

function findOverlaps(intents: IntentSignal[]): IntentOverlap[] {
    const overlaps: IntentOverlap[] = [];

    // Only look at recent intents (last 24 hours worth)
    const recentIntents = intents.filter(i =>
        i.status !== 'complete' &&
        (i.status === 'starting' || i.status === 'implementing' || i.status === 'planning')
    );

    // Compare all pairs
    for (let i = 0; i < recentIntents.length; i++) {
        for (let j = i + 1; j < recentIntents.length; j++) {
            const overlap = calculateOverlap(recentIntents[i], recentIntents[j]);
            if (overlap) {
                overlaps.push(overlap);
            }
        }
    }

    // Sort by severity and score
    return overlaps.sort((a, b) => {
        if (a.severity === 'conflict' && b.severity !== 'conflict') return -1;
        if (b.severity === 'conflict' && a.severity !== 'conflict') return 1;
        return b.overlapScore - a.overlapScore;
    });
}

function formatOverlap(overlap: IntentOverlap): string {
    const icon = overlap.severity === 'conflict' ? '🔴' :
        overlap.severity === 'warn' ? '🟠' : '🟡';

    const label = overlap.severity === 'conflict' ? 'CONFLICT' :
        overlap.severity === 'warn' ? 'WARNING' : 'INFO';

    return `
${icon} ${chalk.bold(label)}: Overlapping intent detected (${overlap.overlapScore}% match)

  ${chalk.cyan(overlap.intent1.agent)} (${overlap.intent1.timestamp}):
    "${overlap.intent1.intent || overlap.intent1.keywords.join(', ')}"
    Status: ${overlap.intent1.status}
    
  ${chalk.cyan(overlap.intent2.agent)} (${overlap.intent2.timestamp}):
    "${overlap.intent2.intent || overlap.intent2.keywords.join(', ')}"
    Status: ${overlap.intent2.status}
    
  Shared keywords: ${chalk.yellow(overlap.sharedKeywords.join(', '))}
  
  ${chalk.gray('Recommendation: Coordinate before continuing')}
`;
}

export const intentScanCommand = new Command('intent-scan')
    .description('Detect overlapping work intentions in collab entries (Layer 3)')
    .option('--days <n>', 'Number of days to scan', '1')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show all detected intents')
    .option('--collab-dir <path>', 'Path to collab directory', process.env.TREEBIRD_INTERNAL
        ? join(process.env.TREEBIRD_INTERNAL, 'collab')
        : join(process.env.HOME || '', 'Dev', 'spidersan', 'collab'))
    .addHelpText('after', `
Examples:
  spidersan intent-scan              # Scan today's collab for overlaps
  spidersan intent-scan --days 3     # Scan last 3 days
  spidersan intent-scan --verbose    # Show all detected intents
  spidersan intent-scan --json       # Output as JSON for tooling

Layer 3 of Spidersan's 7-layer conflict detection:
  L1: File-level (git conflicts)
  L2: Semantic (code dependencies)
  L3: Intent (collab entries) ← THIS
  L4: Temporal (active windows)
  L5: Cross-repo (breaking changes)
  L6: Predictive (pattern analysis)
  L7: Resolution (auto-merge)
`)
    .action((options) => {
        const days = parseInt(options.days) || 1;
        const collabDir = options.collabDir;
        const isJson = options.json;

        if (!existsSync(collabDir)) {
            console.error(chalk.red(`Collab directory not found: ${collabDir}`));
            process.exit(1);
        }

        // Find collab files for the date range
        const files = readdirSync(collabDir)
            .filter(f => f.match(/^\d{4}-\d{2}-\d{2}-daily\.md$/))
            .sort()
            .slice(-days);

        if (files.length === 0) {
            console.log(chalk.yellow('No collab files found'));
            return;
        }

        if (!isJson) {
            console.log(chalk.bold('\n🕷️ INTENT SCAN — Layer 3 Conflict Detection\n'));
            console.log(chalk.gray(`Scanning ${files.length} collab file(s)...\n`));
        }

        // Parse all files
        const allIntents: IntentSignal[] = [];
        for (const file of files) {
            const filePath = join(collabDir, file);
            const intents = parseCollabFile(filePath);
            allIntents.push(...intents);
        }

        // Find overlaps
        const overlaps = findOverlaps(allIntents);

        if (isJson) {
            console.log(JSON.stringify({
                scanned: files,
                intentsFound: allIntents.length,
                overlaps: overlaps,
                summary: {
                    conflicts: overlaps.filter(o => o.severity === 'conflict').length,
                    warnings: overlaps.filter(o => o.severity === 'warn').length,
                    info: overlaps.filter(o => o.severity === 'info').length
                }
            }, null, 2));
            return;
        }

        // Verbose: show all intents
        if (options.verbose) {
            console.log(chalk.bold('📋 Detected Intents:\n'));
            for (const intent of allIntents) {
                const statusIcon = intent.status === 'complete' ? '✅' :
                    intent.status === 'implementing' ? '🔨' :
                        intent.status === 'starting' ? '🚀' :
                            intent.status === 'planning' ? '📝' : '❓';
                console.log(`  ${statusIcon} ${chalk.cyan(intent.agent)} (${intent.timestamp})`);
                console.log(`     ${intent.intent || intent.keywords.join(', ')}`);
                console.log(`     Keywords: ${chalk.gray(intent.keywords.join(', '))}\n`);
            }
        }

        // Show overlaps
        if (overlaps.length === 0) {
            console.log(chalk.green('✅ No overlapping intents detected\n'));
            console.log(chalk.gray(`Scanned ${allIntents.length} intents from ${files.length} file(s)`));
        } else {
            const conflicts = overlaps.filter(o => o.severity === 'conflict');
            const warnings = overlaps.filter(o => o.severity === 'warn');

            console.log(chalk.bold(`Found ${overlaps.length} overlap(s):\n`));

            for (const overlap of overlaps) {
                console.log(formatOverlap(overlap));
            }

            // Summary
            console.log(chalk.bold('Summary:'));
            if (conflicts.length > 0) {
                console.log(chalk.red(`  🔴 ${conflicts.length} conflict(s) — coordinate immediately`));
            }
            if (warnings.length > 0) {
                console.log(chalk.yellow(`  🟠 ${warnings.length} warning(s) — check with agents`));
            }
            console.log(chalk.gray(`  📊 ${allIntents.length} intents scanned from ${files.length} file(s)\n`));
        }
    });
