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
import { execFileSync, spawnSync } from 'child_process';
import { basename } from 'path';
import { homedir } from 'os';
import { getStorage } from '../storage/index.js';
import { ASTParser, SymbolConflict } from '../lib/ast.js';
import { validateAgentId, validateBranchName } from '../lib/security.js';
import { isExcludedPath } from './register.js';
import { loadConfig } from '../lib/config.js';
import { logActivity } from '../lib/activity.js';
import { isGhAvailable, getPRDetails } from '../lib/github.js';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';

// Critical files that trigger TIER 3 blocking
const TIER_3_PATTERNS = [
    /\.env$/,
    /secrets?\./i,
    /credentials/i,
    /password/i,
    /api[_-]?key/i,
    /private[_-]?key/i,
    /\.pem$/,
    /auth\.(ts|js)$/,
    /security\.(ts|js)$/,
];

// Important files that trigger TIER 2 pause
const TIER_2_PATTERNS = [
    /package\.json$/,
    /package-lock\.json$/,
    /tsconfig\.json$/,
    /CLAUDE\.md$/,
    /\.gitignore$/,
    /server\.(ts|js)$/,
    /index\.(ts|js)$/,
    /config\.(ts|js)$/,
];

interface ConflictTier {
    tier: 1 | 2 | 3;
    label: string;
    icon: string;
    action: string;
}


// Optimization: Pre-compile static patterns
const COMPILED_TIER_3 = compilePatterns(TIER_3_PATTERNS);
const COMPILED_TIER_2 = compilePatterns(TIER_2_PATTERNS);

function getConflictTier(file: string, compiledHigh: RegExp[] = [], compiledMedium: RegExp[] = []): ConflictTier {
    // Check TIER 3 first (most critical)
    const tier3 = [...COMPILED_TIER_3, ...compiledHigh];
    for (const pattern of tier3) {
        if (pattern.test(file)) {
            return {
                tier: 3,
                label: 'BLOCK',
                icon: '🔴',
                action: 'Merge blocked. Resolve conflict first.'
            };
        }
    }

    // Check TIER 2 
    const tier2 = [...COMPILED_TIER_2, ...compiledMedium];
    for (const pattern of tier2) {
        if (pattern.test(file)) {
            return {
                tier: 2,
                label: 'PAUSE',
                icon: '🟠',
                action: 'Coordinate with other agent before proceeding.'
            };
        }
    }

    // Default: TIER 1
    return {
        tier: 1,
        label: 'WARN',
        icon: '🟡',
        action: 'Consider coordinating, but safe to proceed.'
    };
}

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

async function notifyHub(branch: string, conflicts: Array<{ branch: string; files: string[]; tier: number }>): Promise<void> {
    const tier3 = conflicts.filter(c => c.tier === 3);
    const tier2 = conflicts.filter(c => c.tier === 2);

    if (tier3.length === 0 && tier2.length === 0) return;

    const severity = tier3.length > 0 ? '🔴 TIER 3 BLOCK' : '🟠 TIER 2 PAUSE';
    const message = `🕷️⚠️ **Conflict Alert** on \`${branch}\`\n\n${severity}\n\nConflicting files require coordination.`;

    try {
        await fetch(`${HUB_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agent: 'spidersan',
                name: 'Spidersan',
                message,
                glyph: '🕷️'
            })
        });
    } catch {
        // Hub offline - silent fail
    }
}

/**
 * Wake a conflicting agent and send them a message about what to fix
 */
async function wakeConflictingAgent(
    agentId: string,
    myBranch: string,
    theirBranch: string,
    conflictingFiles: string[]
): Promise<boolean> {
    const fileList = conflictingFiles.slice(0, 5).join(', ');
    const more = conflictingFiles.length > 5 ? ` (+${conflictingFiles.length - 5} more)` : '';

    // 1. Wake the agent via Hub
    try {
        const wakeResponse = await fetch(`${HUB_URL}/api/wake/${agentId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sender: 'spidersan',
                reason: `Conflict on ${theirBranch} - need resolution`
            })
        });

        if (wakeResponse.ok) {
            console.log(`  🔔 Wake signal sent to ${agentId}`);
        }
    } catch {
        console.log(`  ⚠️ Could not wake ${agentId} via Hub`);
    }

    // 2. Send a detailed mycmail message
    try {
        const { execFileSync } = await import('child_process');

        // Security: Validate inputs before shell execution
        const safeAgentId = validateAgentId(agentId);
        const safeBranch = validateBranchName(theirBranch);
        const safeMyBranch = validateBranchName(myBranch);

        const subject = `🕷️ Conflict Alert: ${safeBranch}`;
        const body = [
            `Hey ${safeAgentId}!`,
            ``,
            `Spidersan detected a conflict between our branches:`,
            ``,
            `  My branch: ${safeMyBranch}`,
            `  Your branch: ${safeBranch}`,
            ``,
            `Conflicting files: ${fileList}${more}`,
            ``,
            `Action needed:`,
            `  1. Check your changes on these files`,
            `  2. Coordinate with me or rebase`,
            `  3. Run: spidersan conflicts --branch ${safeBranch}`,
            ``,
            `Let's sync up! 🕷️`
        ].join('\n');

        // Security: Use execFileSync with argument array instead of string interpolation
        execFileSync('mycmail', ['send', safeAgentId, subject, '-m', body], {
            encoding: 'utf-8',
            stdio: 'pipe'
        });
        console.log(`  📧 Message sent to ${agentId}`);
        return true;
    } catch {
        console.log(`  ⚠️ Could not send mycmail to ${agentId}`);
        return false;
    }
}

/**
 * Wait for a specified time
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Suggest simple resolutions for add/add style conflicts where both branches added the same file
 * Typically occurs with docs or generated files. This prints guidance and a recommended sequence
 * to preserve both variants for auditability (e.g., create a .incoming copy).
 */
function suggestAddAddResolution(conflicts: Array<{ branch: string; files: string[]; tier: number }>): void {
    const addAddFiles = new Set<string>();
    for (const conflict of conflicts) {
        for (const f of conflict.files) {
            // Simple heuristic: docs and markdown files are common add/add candidates
            if (/\.md$/.test(f) || /docs\//.test(f)) {
                addAddFiles.add(f);
            }
        }
    }

    if (addAddFiles.size === 0) return;

    console.log('\n💡 Add/Add Conflict Helper');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Detected files added in both branches. Recommended actions:');
    console.log('  1. Preserve incoming variant for auditability:');
    console.log('       git checkout --theirs <file> && mv <file> <file>.<their-branch>.incoming && git add <file>.<their-branch>.incoming');
    console.log('  2. Keep canonical version in main branch and include note linking the incoming variant.');
    console.log('  3. Commit and continue rebase: git add -A && git rebase --continue');
    console.log('\nExamples:');
    for (const f of addAddFiles) {
        console.log(`   • ${f} -> preserve incoming as ${f}.incoming`);
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

/**
 * Prompt user for Y/N confirmation (prevents Ralph Wiggum loops)
 * @param prompt - The question to ask
 * @param autoConfirm - If true, skip prompt and return true (for --auto mode)
 */
async function confirmAction(prompt: string, autoConfirm: boolean = false): Promise<boolean> {
    if (autoConfirm) {
        console.log(`${prompt} [Y/n]: Y (auto)`);
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
        console.log(JSON.stringify({
            ecosystem: true,
            repos: results,
            summary: { ...totals, repos_scanned: results.length, repos_with_conflicts: reposWithConflicts },
        }, null, 2));
        return;
    }

    console.log(`
🕷️  ECOSYSTEM CONFLICT SCAN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    for (const r of results) {
        if (r.skipped) {
            console.log(`  ⬜ ${r.name.padEnd(22)} (not initialized)`);
            continue;
        }
        if (r.error) {
            console.log(`  ❓ ${r.name.padEnd(22)} (${r.error})`);
            continue;
        }
        const icon = r.tier3 > 0 ? '🔴' : r.tier2 > 0 ? '🟠' : r.tier1 > 0 ? '🟡' : '✅';
        const counts = r.tier3 + r.tier2 + r.tier1 > 0
            ? `  T3:${r.tier3} T2:${r.tier2} T1:${r.tier1}`
            : '  clean';
        console.log(`  ${icon} ${r.name.padEnd(22)}${counts}`);
    }
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Total: 🔴 ${totals.tier3} BLOCK | 🟠 ${totals.tier2} PAUSE | 🟡 ${totals.tier1} WARN`);
    console.log(`   Repos scanned: ${results.length} | With conflicts: ${reposWithConflicts}`);
}

export const conflictsCommand = new Command('conflicts')
    .description('Detect file conflicts between branches (with tiered blocking)')
    .option('--branch <name>', 'Check conflicts for specific branch')
    .option('--pr <number>', 'Check conflicts for a GitHub pull request by number')
    .option('--json', 'Output as JSON')
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
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            process.exit(1);
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
                console.error('❌ Invalid PR number. Provide a positive integer, e.g. --pr 42');
                process.exit(1);
            }
            if (!isGhAvailable()) {
                console.error('❌ GitHub CLI (gh) is not available or not authenticated.');
                console.error('   Install: https://cli.github.com  →  gh auth login');
                process.exit(1);
            }
            let prDetails;
            try {
                prDetails = await getPRDetails(prNumber);
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`❌ Failed to fetch PR #${prNumber}: ${msg}`);
                process.exit(1);
            }
            targetBranch = prDetails.headBranch;
            targetFiles = prDetails.files;
            console.log(`🕷️ Checking conflicts for PR #${prNumber}: "${prDetails.title}"`);
            console.log(`   Branch: ${targetBranch} (${targetFiles.length} file(s) changed)`);
        } else {
            // Normal --branch or current branch mode
            targetBranch = options.branch || getCurrentBranch();
            const target = await storage.get(targetBranch);

            if (!target) {
                console.error(`❌ Branch "${targetBranch}" is not registered.`);
                console.error('   Run: spidersan register --files "..."');
                process.exit(1);
            }
            targetFiles = target.files;
        }

        const allBranches = await storage.list();
        const conflicts: Array<{ branch: string; files: string[]; tier: number; tierInfo: ConflictTier }> = [];

        // Performance Optimization: Convert target files to Set for O(1) lookup
        // Reduces complexity from O(N*M*K) to O(N*M) where N=branches, M=files/branch, K=target_files
        // Filter excluded paths (node_modules/, dist/, etc.) at query time to handle stale registrations
        const targetFilesSet = new Set(targetFiles.filter(f => !isExcludedPath(f)));

        for (const branch of allBranches) {
            if (branch.name === targetBranch || branch.status !== 'active') continue;

            const overlappingFiles = branch.files.filter(f => !isExcludedPath(f) && targetFilesSet.has(f));
            if (overlappingFiles.length > 0) {
                // Get highest tier for this conflict
                let maxTier: ConflictTier = { tier: 1, label: 'WARN', icon: '🟡', action: '' };
                for (const file of overlappingFiles) {
                    const fileTier = getConflictTier(file, compiledHigh, compiledMedium);
                    if (fileTier.tier > maxTier.tier) {
                        maxTier = fileTier;
                    }
                }

                if (maxTier.tier >= minTier) {
                    conflicts.push({
                        branch: branch.name,
                        files: overlappingFiles,
                        tier: maxTier.tier,
                        tierInfo: maxTier
                    });
                }
            }
        }

        // SEMANTIC ANALYSIS with AST parser
        const semanticConflicts: SymbolConflict[] = [];
        if (options.semantic && conflicts.length > 0) {
            console.log('\n🔬 Running semantic (AST) analysis...');
            const astParser = new ASTParser();

            for (const conflict of conflicts) {
                for (const file of conflict.files) {
                    // Only analyze TypeScript/JavaScript files
                    if (!/\.(ts|js|tsx|jsx)$/.test(file)) continue;

                    try {
                        // Get file content from both branches
                        // Security: Use execFileSync to prevent command injection via file names
                        const currentContent = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf-8' });
                        const otherContent = execFileSync('git', ['show', `${conflict.branch}:${file}`], { encoding: 'utf-8' });

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

        // Sort by tier (highest first)
        conflicts.sort((a, b) => b.tier - a.tier);

        // Log conflict detection to activity log
        if (conflicts.length > 0) {
            logActivity({
                event: 'conflict_detected',
                branch: targetBranch,
                details: {
                    tier3: conflicts.filter(c => c.tier === 3).length,
                    tier2: conflicts.filter(c => c.tier === 2).length,
                    tier1: conflicts.filter(c => c.tier === 1).length,
                    conflicting_branches: conflicts.map(c => c.branch),
                }
            });
        }

        // Check for blocking conditions
        const tier3Count = conflicts.filter(c => c.tier === 3).length;
        const tier2Count = conflicts.filter(c => c.tier === 2).length;
        const shouldBlock = options.strict && (tier3Count > 0 || tier2Count > 0);

        // Notify Hub if requested
        if (options.notify && (tier3Count > 0 || tier2Count > 0)) {
            await notifyHub(targetBranch, conflicts);
        }

        if (options.json) {
            console.log(JSON.stringify({
                branch: targetBranch,
                conflicts,
                summary: {
                    tier3: tier3Count,
                    tier2: tier2Count,
                    tier1: conflicts.filter(c => c.tier === 1).length,
                    blocked: shouldBlock
                }
            }, null, 2));

            if (shouldBlock) process.exit(1);
            return;
        }

        if (conflicts.length === 0) {
            console.log(`🕷️ No conflicts detected for "${targetBranch}"`);
            console.log('   ✅ You\'re good to merge!');
            return;
        }

        console.log(`
🕷️ CONFLICT ANALYSIS: "${targetBranch}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        `);

        for (const conflict of conflicts) {
            console.log(`${conflict.tierInfo.icon} TIER ${conflict.tier} (${conflict.tierInfo.label}): ${conflict.branch}`);
            for (const file of conflict.files) {
                const fileTier = getConflictTier(file, compiledHigh, compiledMedium);
                console.log(`   ${fileTier.icon} ${file}`);
            }
            console.log(`   → ${conflict.tierInfo.action}`);
            console.log('');
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📊 Summary: 🔴 ${tier3Count} BLOCK | 🟠 ${tier2Count} PAUSE | 🟡 ${conflicts.filter(c => c.tier === 1).length} WARN`);

        // Offer add/add resolution suggestions for likely add/add files
        suggestAddAddResolution(conflicts);

        // Show semantic analysis results
        if (options.semantic && semanticConflicts.length > 0) {
            console.log(`\n🔬 SEMANTIC CONFLICTS DETECTED (${semanticConflicts.length} symbols):`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            for (const sc of semanticConflicts) {
                console.log(`  ⚡ ${sc.symbolType} '${sc.symbolName}'`);
                console.log(`     Modified in BOTH branches (different content)`);
            }
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log('\n💡 TIP: Coordinate on these specific functions/classes,');
            console.log('   not just the files. One of you should rebase.');
        } else if (options.semantic && semanticConflicts.length === 0) {
            console.log('\n🔬 SEMANTIC ANALYSIS: No symbol-level conflicts!');
            console.log('   Files overlap, but different functions were modified.');
            console.log('   ✅ Likely safe to merge (git will auto-merge).');
        }

        if (tier3Count > 0) {
            console.log(`
🔴 TIER 3 CONFLICTS FOUND
   These files are security-critical and MUST be resolved.
   Merge is BLOCKED until conflicts are cleared.
            `);
        } else if (tier2Count > 0) {
            console.log(`
🟠 TIER 2 CONFLICTS FOUND
   Coordinate with the other agent before proceeding.
   Use: mycmail send <agent> "Need to sync on <file>"
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
                console.log('\n⚠️ No agents registered on conflicting branches.');
            } else {
                // Show what will happen and ask for confirmation
                console.log('\n🔔 WAKE AGENTS?');
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                for (const [agent, info] of agentsToWake) {
                    console.log(`  • ${agent} (${info.branch})`);
                }
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
                console.log('This will:');
                console.log('  1. Send wake signal via Hub');
                console.log('  2. Send mycmail with conflict details\n');

                const confirmed = await confirmAction('Wake these agents?', options.auto);

                if (confirmed) {
                    console.log('\n🔔 WAKING AGENTS...\n');
                    for (const [agentId, info] of agentsToWake) {
                        await wakeConflictingAgent(agentId, targetBranch, info.branch, info.files);
                    }
                    console.log(`\n✅ Woke ${agentsToWake.size} agent(s)`);

                    // If --retry is set, ask before waiting
                    if (options.retry) {
                        const waitSeconds = parseInt(options.retry, 10);
                        const retryConfirmed = await confirmAction(`\nWait ${waitSeconds}s and re-check conflicts?`, options.auto);

                        if (retryConfirmed) {
                            console.log(`\n⏳ Waiting ${waitSeconds}s for agents to resolve conflicts...`);
                            await sleep(waitSeconds * 1000);

                            console.log('\n🔄 RE-CHECKING CONFLICTS...\n');
                            const { execFileSync } = await import('child_process');
                            try {
                                // Security: Use execFileSync with argument array
                                const safeBranch = validateBranchName(targetBranch);
                                const tierArg = String(parseInt(options.tier, 10) || 1);
                                execFileSync('node', [process.argv[1], 'conflicts', '--branch', safeBranch, '--tier', tierArg], {
                                    encoding: 'utf-8',
                                    stdio: 'inherit'
                                });
                                return;
                            } catch {
                                console.log('❌ Conflicts still exist after retry.');
                            }
                        } else {
                            console.log('⏭️ Skipping retry.');
                        }
                    }
                } else {
                    console.log('⏭️ Skipping wake.');
                }
            }
        }

        if (shouldBlock) {
            console.log('❌ Strict mode: Exiting with error due to TIER 2+ conflicts.');
            process.exit(1);
        }
    });
