/**
 * spidersan conflicts
 * 
 * Detect file conflicts between branches.
 * Supports tiered conflict blocking:
 *   TIER 1: Warning only (informational)
 *   TIER 2: Pause (notify agent, recommend action)
 *   TIER 3: Block (exit with error, prevent merge)
 */

import { Command } from 'commander';
import { compilePatterns } from '../lib/regex-utils.js';
import { spawnSync } from 'child_process';
import { basename } from 'path';
import { homedir } from 'os';
import { getStorage } from '../storage/index.js';
import { ASTParser, SymbolConflict } from '../lib/ast.js';
import type { ConflictReport } from '../lib/conflict-analyzer.js';
import { analyzeConflicts } from '../lib/conflict-analyzer.js';
import { renderConflictReport } from '../lib/conflict-renderer.js';
import { getCurrentBranch, getFileAtRef } from '../lib/git.js';
import { validateBranchName } from '../lib/security.js';
import { isExcludedPath } from './register.js';
import { loadConfig } from '../lib/config.js';
import { logActivity } from '../lib/activity.js';
import { isGhAvailable, getPRDetails } from '../lib/github.js';
import { TIER_LABELS, type ConflictTier } from '../lib/conflict-tier.js';
import { createHubClient } from '../lib/hub.js';

type ConflictTierInfo = (typeof TIER_LABELS)[ConflictTier];
type BranchConflict = { branch: string; files: string[]; tier: ConflictTier; tierInfo: ConflictTierInfo };
const hub = createHubClient();

/**
 * Wait for a specified time
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function writeStdout(message: string = ''): void {
    process.stdout.write(`${message}\n`);
}

function writeStderr(message: string): void {
    process.stderr.write(`${message}\n`);
}

function fail(messages: string | string[]): never {
    const output = Array.isArray(messages) ? messages.join('\n') : messages;
    writeStderr(output);
    process.exit(1);
}

/**
 * Prompt user for Y/N confirmation (prevents Ralph Wiggum loops)
 * @param prompt - The question to ask
 * @param autoConfirm - If true, skip prompt and return true (for --auto mode)
 */
async function confirmAction(prompt: string, autoConfirm: boolean = false): Promise<boolean> {
    if (autoConfirm) {
        writeStdout(`${prompt} [Y/n]: Y (auto)`);
        return true;
    }

    const readline = await import('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(`${prompt} [Y/n]: `, (answer) => {
            rl.close();
            const normalized = answer.toLowerCase().trim();
            resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
        });
    });
}

function filterConflictReport(report: ConflictReport, minTier: ConflictTier): ConflictReport {
    const conflicts = report.conflicts.filter((conflict) => conflict.tier >= minTier);
    const byTier: Record<ConflictTier, ConflictReport['conflicts']> = {
        1: conflicts.filter((conflict) => conflict.tier === 1),
        2: conflicts.filter((conflict) => conflict.tier === 2),
        3: conflicts.filter((conflict) => conflict.tier === 3),
    };
    const highest = conflicts.length > 0
        ? conflicts.reduce<ConflictTier>((max, conflict) => (conflict.tier > max ? conflict.tier : max), 1)
        : 1;

    return {
        conflicts,
        byTier,
        highest,
        shouldBlock: highest === 3,
    };
}

function buildBranchConflicts(report: ConflictReport): BranchConflict[] {
    const branchOrder = inferBranchOrder(report);
    const branchOrderIndex = new Map(branchOrder.map((branch, index) => [branch, index]));
    const grouped = new Map<string, BranchConflict>();

    for (const conflict of report.conflicts) {
        for (const branch of conflict.branches) {
            let entry = grouped.get(branch.name);
            if (!entry) {
                entry = {
                    branch: branch.name,
                    files: [],
                    tier: 1,
                    tierInfo: TIER_LABELS[1],
                };
                grouped.set(branch.name, entry);
            }

            if (!entry.files.includes(conflict.file)) {
                entry.files.push(conflict.file);
            }

            if (conflict.tier > entry.tier) {
                entry.tier = conflict.tier;
                entry.tierInfo = TIER_LABELS[conflict.tier];
            }
        }
    }

    return [...grouped.values()].sort((left, right) => {
        if (right.tier !== left.tier) {
            return right.tier - left.tier;
        }

        return (branchOrderIndex.get(left.branch) ?? Number.MAX_SAFE_INTEGER)
            - (branchOrderIndex.get(right.branch) ?? Number.MAX_SAFE_INTEGER);
    });
}

function inferBranchOrder(report: ConflictReport): string[] {
    const adjacency = new Map<string, Set<string>>();
    const indegree = new Map<string, number>();
    const firstSeen = new Map<string, number>();
    let seenIndex = 0;

    const ensureBranch = (branch: string): void => {
        if (!adjacency.has(branch)) {
            adjacency.set(branch, new Set<string>());
        }
        if (!indegree.has(branch)) {
            indegree.set(branch, 0);
        }
        if (!firstSeen.has(branch)) {
            firstSeen.set(branch, seenIndex++);
        }
    };

    for (const conflict of report.conflicts) {
        const branchNames = conflict.branches.map((branch) => branch.name);
        for (const branch of branchNames) {
            ensureBranch(branch);
        }

        for (let index = 0; index < branchNames.length; index++) {
            for (let nextIndex = index + 1; nextIndex < branchNames.length; nextIndex++) {
                const from = branchNames[index];
                const to = branchNames[nextIndex];
                const edges = adjacency.get(from);
                if (!edges || edges.has(to)) {
                    continue;
                }

                edges.add(to);
                indegree.set(to, (indegree.get(to) ?? 0) + 1);
            }
        }
    }

    const queue = [...indegree.entries()]
        .filter(([, degree]) => degree === 0)
        .map(([branch]) => branch)
        .sort((left, right) => (firstSeen.get(left) ?? 0) - (firstSeen.get(right) ?? 0));
    const ordered: string[] = [];

    while (queue.length > 0) {
        const branch = queue.shift();
        if (!branch) {
            break;
        }

        ordered.push(branch);

        for (const next of adjacency.get(branch) ?? []) {
            const nextDegree = (indegree.get(next) ?? 0) - 1;
            indegree.set(next, nextDegree);
            if (nextDegree === 0) {
                queue.push(next);
                queue.sort((left, right) => (firstSeen.get(left) ?? 0) - (firstSeen.get(right) ?? 0));
            }
        }
    }

    if (ordered.length === indegree.size) {
        return ordered;
    }

    return [...firstSeen.entries()]
        .sort((left, right) => left[1] - right[1])
        .map(([branch]) => branch);
}

function countByTier(report: ConflictReport): { tier1: number; tier2: number; tier3: number } {
    const conflicts = buildBranchConflicts(report);

    return {
        tier1: conflicts.filter((conflict) => conflict.tier === 1).length,
        tier2: conflicts.filter((conflict) => conflict.tier === 2).length,
        tier3: conflicts.filter((conflict) => conflict.tier === 3).length,
    };
}

function createJsonReport(report: ConflictReport, branch: string, blocked: boolean): ConflictReport & {
    branch: string;
    summary: { tier1: number; tier2: number; tier3: number; blocked: boolean };
    conflicts: Array<ConflictReport['conflicts'][number] & { files: string[]; branch?: string }>;
} {
    const summary = countByTier(report);

    return {
        ...report,
        branch,
        conflicts: report.conflicts.map((conflict) => ({
            ...conflict,
            files: [conflict.file],
            branch: conflict.branches[0]?.name,
        })),
        summary: {
            ...summary,
            blocked,
        },
    };
}

// ── Ecosystem scan ────────────────────────────────────────────────────────────

/**
 * Default ecosystem repos. Configurable via SPIDERSAN_ECOSYSTEM env var.
 * Falls back to ~/Dev/ structure (old) or ~/Dev/projects/ structure (new).
 */
function getDefaultEcosystemRepos(): string[] {
    if (process.env.SPIDERSAN_ECOSYSTEM) {
        return process.env.SPIDERSAN_ECOSYSTEM.split(':').map((r) => r.trim()).filter(Boolean);
    }
    const homeDir = process.env.HOME || homedir();
    return [
        `${homeDir}/Dev/Envoak`,
        `${homeDir}/Dev/treebird-internal`,
        `${homeDir}/Dev/spidersan`,
        `${homeDir}/Dev/Toak`,
        `${homeDir}/Dev/flockview`,
        `${homeDir}/Dev/mappersan`,
        `${homeDir}/Dev/treebird`,
        `${homeDir}/Dev/treementor`,
        // Agent repos
        `${homeDir}/Dev/Artisan`,
        `${homeDir}/Dev/Birdsan`,
        `${homeDir}/Dev/Cosan`,
        `${homeDir}/Dev/Marksan`,
        `${homeDir}/Dev/Sherlocksan`,
        `${homeDir}/Dev/Teachersan`,
        `${homeDir}/Dev/Watsan`,
        `${homeDir}/Dev/Yosef`,
        // Tools & libs
        `${homeDir}/Dev/boidz`,
        `${homeDir}/Dev/beads`,
        `${homeDir}/Dev/birdseye`,
        `${homeDir}/Dev/invoak`,
        `${homeDir}/Dev/myceliumail`,
        `${homeDir}/Dev/nanoclaw`,
        `${homeDir}/Dev/nanoclaw-private`,
        `${homeDir}/Dev/proaksy`,
        `${homeDir}/Dev/sasu`,
        `${homeDir}/Dev/skills`,
        `${homeDir}/Dev/spidersan`,
        `${homeDir}/Dev/treebird-heavy`,
        `${homeDir}/Dev/Recovery-Tree-New`,
    ];
}

const DEFAULT_ECOSYSTEM_REPOS = getDefaultEcosystemRepos();

interface EcosystemRepoResult {
    repo: string;
    name: string;
    tier3: number;
    tier2: number;
    tier1: number;
    skipped?: boolean;
    error?: string;
}

function runEcosystemScan(repos: string[], asJson: boolean): void {
    const results: EcosystemRepoResult[] = [];

    for (const repo of repos) {
        const name = basename(repo);
        const result = spawnSync(
            'spidersan',
            ['conflicts', '--json'],
            { cwd: repo, encoding: 'utf-8', timeout: 15000 },
        );

        if (result.status === null || result.error) {
            results.push({ repo, name, tier3: 0, tier2: 0, tier1: 0, error: 'spawn failed' });
            continue;
        }

        if (result.status !== 0) {
            // Exit 1 can be --strict mode; try to parse stdout anyway
            // If it says "not initialized", mark as skipped
            const combinedOut = (result.stderr ?? '') + (result.stdout ?? '');
            if (combinedOut.includes('not initialized') || combinedOut.includes('not registered')) {
                results.push({ repo, name, tier3: 0, tier2: 0, tier1: 0, skipped: true });
                continue;
            }
        }

        try {
            const data = JSON.parse(result.stdout) as { summary: { tier3: number; tier2: number; tier1: number } };
            results.push({
                repo,
                name,
                tier3: data.summary.tier3,
                tier2: data.summary.tier2,
                tier1: data.summary.tier1,
            });
        } catch {
            results.push({ repo, name, tier3: 0, tier2: 0, tier1: 0, error: 'parse failed' });
        }
    }

    const totals = results.reduce(
        (acc, r) => ({ tier3: acc.tier3 + r.tier3, tier2: acc.tier2 + r.tier2, tier1: acc.tier1 + r.tier1 }),
        { tier3: 0, tier2: 0, tier1: 0 },
    );
    const reposWithConflicts = results.filter(r => r.tier3 + r.tier2 + r.tier1 > 0).length;

    if (asJson) {
        writeStdout(JSON.stringify({
            ecosystem: true,
            repos: results,
            summary: { ...totals, repos_scanned: results.length, repos_with_conflicts: reposWithConflicts },
        }, null, 2));
        return;
    }

    writeStdout(`
🕷️  ECOSYSTEM CONFLICT SCAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    for (const r of results) {
        if (r.skipped) {
            writeStdout(`  ⬜ ${r.name.padEnd(22)} (not initialized)`);
            continue;
        }
        if (r.error) {
            writeStdout(`  ❓ ${r.name.padEnd(22)} (${r.error})`);
            continue;
        }
        const icon = r.tier3 > 0 ? '🔴' : r.tier2 > 0 ? '🟠' : r.tier1 > 0 ? '🟡' : '✅';
        const counts = r.tier3 + r.tier2 + r.tier1 > 0
            ? `  T3:${r.tier3} T2:${r.tier2} T1:${r.tier1}`
            : '  clean';
        writeStdout(`  ${icon} ${r.name.padEnd(22)}${counts}`);
    }
    writeStdout('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    writeStdout(`📊 Total: 🔴 ${totals.tier3} BLOCK | 🟠 ${totals.tier2} PAUSE | 🟡 ${totals.tier1} WARN`);
    writeStdout(`   Repos scanned: ${results.length} | With conflicts: ${reposWithConflicts}`);
}

export const conflictsCommand = new Command('conflicts')
    .description('Detect file conflicts between branches (with tiered blocking)')
    .option('--branch <name>', 'Check conflicts for specific branch')
    .option('--pr <number>', 'Check conflicts for a GitHub pull request by number')
    .option('--json', 'Output as JSON')
    .option('--verbose', 'Show detailed symbol overlap information in human output')
    .option('--tier <level>', 'Filter by minimum tier (1, 2, or 3)', '1')
    .option('--strict', 'Strict mode: exit with error if TIER 2+ conflicts found')
    .option('--notify', 'Notify Hub of TIER 2+ conflicts')
    .option('--wake', 'Wake conflicting agents and send them fix instructions')
    .option('--retry <seconds>', 'After waking, wait N seconds and re-check conflicts')
    .option('--auto', 'Auto mode: skip confirmations (enables Ralph Wiggum loop)')
    .option('--max-retries <count>', 'Maximum retry attempts in auto mode (default: 5)', '5')
    .option('--semantic', 'Use semantic (AST) analysis for symbol-level conflict detection')
    .option('--ecosystem', 'Scan all ecosystem repos and aggregate conflict tiers')
    .option('--repos <paths>', 'Comma-separated repo paths for --ecosystem scan')
    .action(async (options) => {
        // ── Ecosystem shortcut ───────────────────────────────────────────────
        if (options.ecosystem) {
            const repos = options.repos
                ? (options.repos as string).split(',').map((r: string) => r.trim()).filter(Boolean)
                : DEFAULT_ECOSYSTEM_REPOS;
            runEcosystemScan(repos, !!options.json);
            return;
        }
        const storage = await getStorage();
        const config = await loadConfig();

        if (!await storage.isInitialized()) {
            fail('❌ Spidersan not initialized. Run: spidersan init');
        }

        const minTier = parseInt(options.tier, 10) as 1 | 2 | 3;

        // Load custom patterns from config
        const highSeverity = (config.conflicts?.highSeverityPatterns || []).map(p => new RegExp(p));
        const mediumSeverity = (config.conflicts?.mediumSeverityPatterns || []).map(p => new RegExp(p));

        const compiledHigh = compilePatterns(highSeverity);
        const compiledMedium = compilePatterns(mediumSeverity);

        let targetBranch: string;
        let targetFiles: string[];

        if (options.pr) {
            // --pr mode: fetch PR head branch + changed files from GitHub
            const prNumber = parseInt(options.pr, 10);
            if (isNaN(prNumber) || prNumber <= 0) {
                fail('❌ Invalid PR number. Provide a positive integer, e.g. --pr 42');
            }
            if (!isGhAvailable()) {
                fail([
                    '❌ GitHub CLI (gh) is not available or not authenticated.',
                    '   Install: https://cli.github.com  →  gh auth login',
                ]);
            }
            let prDetails;
            try {
                prDetails = await getPRDetails(prNumber);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                fail(`❌ Failed to fetch PR #${prNumber}: ${msg}`);
            }
            targetBranch = prDetails.headBranch;
            targetFiles = prDetails.files;
            writeStdout(`🕷️ Checking conflicts for PR #${prNumber}: "${prDetails.title}"`);
            writeStdout(`   Branch: ${targetBranch} (${targetFiles.length} file(s) changed)`);
        } else {
            // Normal --branch or current branch mode
            targetBranch = options.branch || getCurrentBranch();
            const target = await storage.get(targetBranch);

            if (!target) {
                fail([
                    `❌ Branch "${targetBranch}" is not registered.`,
                    '   Run: spidersan register --files "..."',
                ]);
            }
            targetFiles = target.files;
        }

        const allBranches = await storage.list();
        const analysisBranches = allBranches
            .filter(branch => branch.name !== targetBranch && branch.status === 'active')
            .map(branch => ({
                ...branch,
                files: branch.files.filter(file => !isExcludedPath(file)),
            }));

        const rawReport = analyzeConflicts({
            branches: analysisBranches,
            targetFiles: targetFiles.filter(file => !isExcludedPath(file)),
            options: {
                extraTier3: compiledHigh,
                extraTier2: compiledMedium,
                useSymbolAware: false,
            },
        });
        const report = filterConflictReport(rawReport, minTier);
        const conflicts = buildBranchConflicts(report);

        // SEMANTIC ANALYSIS with AST parser
        const semanticConflicts: SymbolConflict[] = [];
        if (options.semantic && conflicts.length > 0) {
            writeStdout('\n🔬 Running semantic (AST) analysis...');
            const astParser = new ASTParser();

            for (const conflict of conflicts) {
                for (const file of conflict.files) {
                    // Only analyze TypeScript/JavaScript files
                    if (!/\.(ts|js|tsx|jsx)$/.test(file)) continue;

                    try {
                        const currentContent = getFileAtRef('HEAD', file);
                        const otherContent = getFileAtRef(conflict.branch, file);
                        if (currentContent === null || otherContent === null) {
                            continue;
                        }

                        const symbolConflicts = astParser.findSymbolConflicts(
                            currentContent, `${targetBranch}:${file}`,
                            otherContent, `${conflict.branch}:${file}`
                        );

                        semanticConflicts.push(...symbolConflicts);
                    } catch {
                        // File might not exist in one branch, skip
                    }
                }
            }
        }

        // Log conflict detection to activity log
        if (conflicts.length > 0) {
            try {
                const summary = countByTier(report);
                logActivity({
                    event: 'conflict_detected',
                    branch: targetBranch,
                    details: {
                        tier3: summary.tier3,
                        tier2: summary.tier2,
                        tier1: summary.tier1,
                        conflicting_branches: conflicts.map(c => c.branch),
                    }
                });
            } catch {
                // Telemetry should never block conflict detection.
            }
        }

        // Check for blocking conditions
        const { tier2: tier2Count, tier3: tier3Count } = countByTier(report);
        const shouldBlock = options.strict && (tier3Count > 0 || tier2Count > 0);

        // Notify Hub if requested
        if (options.notify && (tier3Count > 0 || tier2Count > 0)) {
            await hub.notifyConflict(targetBranch, conflicts);
        }

        if (options.json) {
            console.log(JSON.stringify(createJsonReport(report, targetBranch, shouldBlock), null, 2));

            if (shouldBlock) process.exit(1);
            return;
        }

        const renderedReport = renderConflictReport(report, { verbose: !!options.verbose });
        const humanOutput = conflicts.length === 0
            ? renderedReport.replace('🕷️ No conflicts detected', `🕷️ No conflicts detected for "${targetBranch}"`)
            : `
🕷️ CONFLICT ANALYSIS: "${targetBranch}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        
${renderedReport}`;
        console.log(humanOutput);

        // Show semantic analysis results
        if (options.semantic && semanticConflicts.length > 0) {
            writeStdout(`\n🔬 SEMANTIC CONFLICTS DETECTED (${semanticConflicts.length} symbols):`);
            writeStdout('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            for (const sc of semanticConflicts) {
                writeStdout(`  ⚡ ${sc.symbolType} '${sc.symbolName}'`);
                writeStdout('     Modified in BOTH branches (different content)');
            }
            writeStdout('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            writeStdout('\n💡 TIP: Coordinate on these specific functions/classes,');
            writeStdout('   not just the files. One of you should rebase.');
        } else if (options.semantic && semanticConflicts.length === 0) {
            writeStdout('\n🔬 SEMANTIC ANALYSIS: No symbol-level conflicts!');
            writeStdout('   Files overlap, but different functions were modified.');
            writeStdout('   ✅ Likely safe to merge (git will auto-merge).');
        }

        if (tier3Count > 0) {
            writeStdout(`
🔴 TIER 3 CONFLICTS FOUND
   These files are security-critical and MUST be resolved.
   Merge is BLOCKED until conflicts are cleared.
            `);
        } else if (tier2Count > 0) {
            writeStdout(`
🟠 TIER 2 CONFLICTS FOUND
   Coordinate with the other agent before proceeding.
            `);
        }

        // Wake conflicting agents if --wake flag is set
        if (options.wake && conflicts.length > 0) {
            // Collect agents to wake
            const agentsToWake = new Map<string, { branch: string; files: string[] }>();

            // Performance Optimization: Use the already fetched allBranches
            // to avoid N+1 slow network requests to storage.get()
            const branchMap = new Map(allBranches.map(b => [b.name, b]));

            for (const conflict of conflicts) {
                const conflictBranch = branchMap.get(conflict.branch);
                const agentId = conflictBranch?.agent;
                if (agentId && !agentsToWake.has(agentId)) {
                    agentsToWake.set(agentId, { branch: conflict.branch, files: conflict.files });
                }
            }

            if (agentsToWake.size === 0) {
                writeStdout('\n⚠️ No agents registered on conflicting branches.');
            } else {
                // Show what will happen and ask for confirmation
                writeStdout('\n🔔 WAKE AGENTS?');
                writeStdout('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (const [agent, info] of agentsToWake) {
                    writeStdout(`  • ${agent} (${info.branch})`);
                }
                writeStdout('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                writeStdout('This will:');
                writeStdout('  1. Send wake signal via Hub\n');

                const confirmed = await confirmAction('Wake these agents?', options.auto);

                if (confirmed) {
                    writeStdout('\n🔔 WAKING AGENTS...\n');
                    for (const [agentId, info] of agentsToWake) {
                        const woke = await hub.wakeAgent(
                            agentId,
                            `Conflict on ${info.branch} - need resolution`,
                        );
                        if (woke) {
                            writeStdout(`  🔔 Wake signal sent to ${agentId}`);
                        } else {
                            writeStdout(`  ⚠️ Could not wake ${agentId} via Hub`);
                        }
                    }
                    writeStdout(`\n✅ Woke ${agentsToWake.size} agent(s)`);

                    // If --retry is set, ask before waiting
                    if (options.retry) {
                        const waitSeconds = parseInt(options.retry, 10);
                        const retryConfirmed = await confirmAction(`\nWait ${waitSeconds}s and re-check conflicts?`, options.auto);

                        if (retryConfirmed) {
                            writeStdout(`\n⏳ Waiting ${waitSeconds}s for agents to resolve conflicts...`);
                            await sleep(waitSeconds * 1000);

                            writeStdout('\n🔄 RE-CHECKING CONFLICTS...\n');
                            const { execFileSync } = await import('child_process');
                            try {
                                const { getCLIPath } = await import('../lib/security.js');
                                // Security: Use execFileSync with argument array
                                const safeBranch = validateBranchName(targetBranch);
                                const tierArg = String(parseInt(options.tier, 10) || 1);
                                execFileSync(process.execPath, [getCLIPath(), 'conflicts', '--branch', safeBranch, '--tier', tierArg], {
                                    encoding: 'utf-8',
                                    stdio: 'inherit'
                                });
                                return;
                            } catch {
                                writeStdout('❌ Conflicts still exist after retry.');
                            }
                        } else {
                            writeStdout('⏭️ Skipping retry.');
                        }
                    }
                } else {
                    writeStdout('⏭️ Skipping wake.');
                }
            }
        }

        if (shouldBlock) {
            writeStdout('❌ Strict mode: Exiting with error due to TIER 2+ conflicts.');
            process.exit(1);
        }
    });
