/**
 * spidersan tension
 * 
 * Exposes structured tension data for security pipeline integration.
 * Designed for Sherlocksan audit workflow (srlk).
 * 
 * Part of: Security Pipeline (ssan + srlk)
 * See: treebird-internal/collab/DESIGN_security_pipeline_ssan_srlk.md
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { getStorage } from '../storage/index.js';
import { validateFilePath } from '../lib/security.js';

// Security-sensitive file patterns
const SECURITY_PATTERNS = [
    /\.env$/i,
    /auth[^/]*\.(ts|js|tsx|jsx)$/i,
    /secret/i,
    /password/i,
    /token/i,
    /key[^/]*\.(ts|js|json)$/i,
    /credential/i,
    /api[_-]?key/i,
];

interface TensionFile {
    file: string;
    conflicting_branches: string[];
    agents: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
    last_modified?: string;
    git_blame_summary?: string;
    is_security_sensitive: boolean;
}

interface TensionReport {
    timestamp: string;
    branch: string;
    repo: string;  // Added for security pipeline schema compliance
    tensions: TensionFile[];
    health_score: number;
    trigger_reason: string;
    total_conflicts: number;
    summary: {
        critical: number;
        high: number;
        medium: number;
        low: number;
    };
}

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

function getRepoName(): string {
    try {
        const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
        return match ? match[1] : process.cwd().split('/').pop() || 'unknown';
    } catch {
        return process.cwd().split('/').pop() || 'unknown';
    }
}

function isSecuritySensitive(filepath: string): boolean {
    return SECURITY_PATTERNS.some(pattern => pattern.test(filepath));
}

function calculateSeverity(
    conflictingBranches: string[],
    isSecurityFile: boolean
): 'critical' | 'high' | 'medium' | 'low' {
    if (isSecurityFile) {
        return 'critical';
    }
    if (conflictingBranches.length >= 3) {
        return 'high';
    }
    if (conflictingBranches.length === 2) {
        return 'medium';
    }
    return 'low';
}

function getGitBlameOwner(filepath: string): string | undefined {
    try {
        // Get the author who owns the most lines
        const safePath = validateFilePath(filepath);
        const blameOutput = execFileSync(
            'git',
            ['blame', '--porcelain', '--', safePath],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        );

        const counts = new Map<string, number>();
        for (const line of blameOutput.split('\n')) {
            if (!line.startsWith('author ')) continue;
            const author = line.slice('author '.length).trim();
            counts.set(author, (counts.get(author) || 0) + 1);
        }

        let topAuthor: string | undefined;
        let topCount = 0;
        for (const [author, count] of counts) {
            if (count > topCount) {
                topAuthor = author;
                topCount = count;
            }
        }

        return topAuthor;
    } catch {
        return undefined;
    }
}

function getLastModified(filepath: string): string | undefined {
    try {
        const safePath = validateFilePath(filepath);
        const log = execFileSync(
            'git',
            ['log', '-1', '--format=%aI', '--', safePath],
            { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
        ).trim();
        return log || undefined;
    } catch {
        return undefined;
    }
}

function daysBetween(date1: Date, date2: Date): number {
    const diffMs = Math.abs(date2.getTime() - date1.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export const tensionCommand = new Command('tension')
    .description('Show file tensions for security pipeline (srlk integration)')
    .option('--branch <name>', 'Check tensions for specific branch')
    .option('--json', 'Output as JSON (for sherlocksan audit --from-json)')
    .option('--severity <level>', 'Minimum severity: critical, high, medium, low', 'low')
    .option('--include-blame', 'Include git blame summary (slower)')
    .option('--alert-threshold <n>', 'Exit with code 1 if health below N%', parseInt)
    .action(async (options) => {
        const storage = await getStorage();
        const now = new Date();
        const STALE_DAYS = 7;

        if (!await storage.isInitialized()) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
        }

        const targetBranch = options.branch || getCurrentBranch();
        const target = await storage.get(targetBranch);

        // Build tension report
        const report: TensionReport = {
            timestamp: now.toISOString(),
            branch: targetBranch,
            repo: getRepoName(),
            tensions: [],
            health_score: 100,
            trigger_reason: 'manual check',
            total_conflicts: 0,
            summary: { critical: 0, high: 0, medium: 0, low: 0 },
        };

        const allBranches = await storage.list();
        const activeBranches = allBranches.filter(b => b.status === 'active');

        // Calculate health score
        const staleBranches = activeBranches.filter(
            b => daysBetween(new Date(b.registeredAt), now) > STALE_DAYS
        );

        if (activeBranches.length === 0) {
            report.health_score = 0;
            report.trigger_reason = 'no active branches';
        } else {
            const staleRatio = staleBranches.length / activeBranches.length;
            report.health_score = Math.round((1 - staleRatio) * 100);
        }

        // If we have a target branch, find conflicts
        if (target) {
            const fileConflictMap = new Map<string, { branches: string[]; agents: Set<string> }>();

            for (const branch of allBranches) {
                if (branch.name === targetBranch) continue;
                if (branch.status !== 'active') continue;

                const overlappingFiles = branch.files.filter(f => target.files.includes(f));
                for (const file of overlappingFiles) {
                    if (!fileConflictMap.has(file)) {
                        fileConflictMap.set(file, { branches: [], agents: new Set() });
                    }
                    const entry = fileConflictMap.get(file)!;
                    entry.branches.push(branch.name);
                    if (branch.agent) {
                        entry.agents.add(branch.agent);
                    }
                }
            }

            // Add target branch's agent too
            if (target.agent) {
                for (const [, entry] of fileConflictMap) {
                    entry.agents.add(target.agent);
                }
            }

            // Convert to tension entries
            for (const [file, conflict] of fileConflictMap) {
                const isSecure = isSecuritySensitive(file);
                const severity = calculateSeverity(conflict.branches, isSecure);

                const tension: TensionFile = {
                    file,
                    conflicting_branches: conflict.branches,
                    agents: Array.from(conflict.agents),
                    severity,
                    is_security_sensitive: isSecure,
                };

                if (options.includeBame) {
                    tension.git_blame_summary = getGitBlameOwner(file);
                    tension.last_modified = getLastModified(file);
                }

                report.tensions.push(tension);
                report.summary[severity]++;
            }

            report.total_conflicts = report.tensions.length;
        } else {
            report.trigger_reason = `branch "${targetBranch}" not registered`;
        }

        // Add stale branches to trigger reason
        if (staleBranches.length > 0) {
            report.trigger_reason = `${staleBranches.length} stale branches`;
        }

        // Filter by severity if specified
        const severityOrder: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
        const minSeverity = severityOrder[options.severity] || 1;
        report.tensions = report.tensions.filter(t => severityOrder[t.severity] >= minSeverity);

        // JSON output (for sherlocksan audit --from-json)
        if (options.json) {
            console.log(JSON.stringify(report, null, 2));

            // Alert threshold check
            if (options.alertThreshold && report.health_score < options.alertThreshold) {
                process.exit(1);
            }
            return;
        }

        // Human-readable output
        console.log('');
        console.log('🕷️  Spidersan Tension Report');
        console.log('');

        // Health bar
        const healthEmoji = report.health_score >= 80 ? '💚' :
            report.health_score >= 50 ? '💛' :
                report.health_score >= 25 ? '🧡' : '❤️';
        const scoreBar = '█'.repeat(Math.floor(report.health_score / 10)) +
            '░'.repeat(10 - Math.floor(report.health_score / 10));
        console.log(`   ${healthEmoji} Health: [${scoreBar}] ${report.health_score}%`);
        console.log(`   📍 Branch: ${targetBranch}`);
        console.log(`   🔍 Trigger: ${report.trigger_reason}`);
        console.log('');

        if (report.tensions.length === 0) {
            console.log('   ✅ No file tensions detected');
            console.log('');
        } else {
            console.log(`   ⚠️  ${report.total_conflicts} file tension(s):`);
            console.log('');

            // Group by severity
            for (const severity of ['critical', 'high', 'medium', 'low'] as const) {
                const tensionsAtLevel = report.tensions.filter(t => t.severity === severity);
                if (tensionsAtLevel.length === 0) continue;

                const severityEmoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
                console.log(`   ${severityEmoji[severity]} ${severity.toUpperCase()} (${tensionsAtLevel.length}):`);

                for (const tension of tensionsAtLevel) {
                    const securityFlag = tension.is_security_sensitive ? ' 🔐' : '';
                    console.log(`      └─ ${tension.file}${securityFlag}`);
                    console.log(`         Conflicts with: ${tension.conflicting_branches.join(', ')}`);
                    if (tension.agents.length > 0) {
                        console.log(`         Agents: ${tension.agents.join(', ')}`);
                    }
                }
                console.log('');
            }
        }

        // Summary
        console.log('   📊 Summary:');
        console.log(`      • Critical: ${report.summary.critical}`);
        console.log(`      • High: ${report.summary.high}`);
        console.log(`      • Medium: ${report.summary.medium}`);
        console.log(`      • Low: ${report.summary.low}`);
        console.log('');

        console.log('   💡 Tip: Use --json to pipe to sherlocksan:');
        console.log('      spidersan tension --json | sherlocksan audit --from-json');
        console.log('');

        // Alert threshold check
        if (options.alertThreshold && report.health_score < options.alertThreshold) {
            console.log(`   🚨 Alert: Health below threshold (${report.health_score}% < ${options.alertThreshold}%)`);
            process.exit(1);
        }
    });
