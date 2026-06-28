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
import { validateBranchName, getCLIPath } from '../lib/security.js';
import { isExcludedPath } from './register.js';
import { loadConfig } from '../lib/config.js';
import { logActivity } from '../lib/activity.js';
import { isGhAvailable, getPRDetails, listOpenPRs, getPRChangedFiles } from '../lib/github.js';
import { classifyWithLabel } from '../lib/conflict-tier.js';
import { analyzeRealConflicts, type RealConflictReport } from '../lib/git-merge-analyzer.js';
import { getTrunkBranch } from '../lib/trunk.js';
import { activeBranches } from '../lib/reconcile.js';

// Config
const HUB_URL = process.env.HUB_URL || 'https://hub.treebird.uk';

type ConflictTierInfo = ReturnType<typeof classifyWithLabel>;

function getCurrentBranch(): string {
    try {
        return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
        throw new Error('Not in a git repository');
    }
}

async function notifyHub(branch: string, conflicts: Array<{ branch: string; files: string[]; tier: number }>): Promise<void> {
    let hasTier3 = false;
    let hasTier2 = false;
    for (const c of conflicts) {
        if (c.tier === 3) hasTier3 = true;
        else if (c.tier === 2) hasTier2 = true;
        if (hasTier3 && hasTier2) break;
    }

    if (!hasTier3 && !hasTier2) return;

    const severity = hasTier3 ? '🔴 TIER 3 BLOCK' : '🟠 TIER 2 PAUSE';
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
    _conflictingFiles: string[]
): Promise<boolean> {
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

    return true;
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
            process.execPath,
            [getCLIPath(), 'conflicts', '--json'],
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

// ── Real (git merge-tree) conflict scan ─────────────────────────────────────────

/**
 * Render a single real-conflict report (git merge-tree backed) to the console.
 * `✅ <branch>: clean vs <base>` or `⚠️ <branch>: N real conflict(s) vs <base>`
 * with the conflicting file list + kind, plus a dim `method` line. On an
 * environmental `error`, prints it and returns (caller continues to the next target).
 */
function renderRealReport(report: RealConflictReport): void {
    if (report.error) {
        console.log(`❌ ${report.branch}: ${report.error}`);
        return;
    }

    if (report.clean) {
        console.log(`✅ ${report.branch}: clean vs ${report.base}`);
    } else {
        const n = report.conflicts.length;
        console.log(`⚠️ ${report.branch}: ${n} real conflict${n === 1 ? '' : 's'} vs ${report.base}`);
        for (const c of report.conflicts) {
            console.log(`   • ${c.file} (${c.kind})`);
        }
    }
    // Dim trailing line showing which git path produced the result.
    console.log(`\x1b[2m   method: ${report.method}\x1b[0m`);
}

/**
 * `conflicts --real`: compute TRUE merge conflicts via git merge-tree against the
 * trunk (or `--base`), for the current branch / `--branch` / (with `--all`) every
 * active registered branch.
 *
 * Pure git for the single-target path — works with NO `.spidersan/registry.json`.
 * Only `--all` (which enumerates registered branches) requires an initialized
 * registry, and that path is gated here.
 *
 * @returns the process exit code (0 always, unless `--exit-code` + conflicts → 1).
 */
async function runRealConflicts(options: {
    base?: string;
    branch?: string;
    pr?: string;
    all?: boolean;
    json?: boolean;
    exitCode?: boolean;
}): Promise<number> {
    let base = options.base || getTrunkBranch();

    // Determine target branches.
    let targets: string[];
    if (options.pr) {
        // --pr in real mode: the PR head isn't a local ref, so fetch it. Without
        // this, --real fell through to getCurrentBranch() and silently checked
        // trunk-vs-trunk → a false "clean" (tb-57fr).
        const prNumber = parseInt(options.pr, 10);
        if (isNaN(prNumber) || prNumber <= 0) {
            console.error('❌ Invalid PR number. Provide a positive integer, e.g. --pr 42');
            return 1;
        }
        const ref = `refs/spidersan/pr-${prNumber}`;
        try {
            // pull/<n>/head exists on the base repo even for fork PRs.
            execFileSync('git', ['fetch', '--quiet', 'origin', `pull/${prNumber}/head:${ref}`], { stdio: 'pipe' });
            // Check against the REMOTE trunk, not a possibly-stale local one — a PR
            // merges into origin's HEAD. Falling back to local `main` (which can lag)
            // is the same false-confidence class as tb-57fr.
            if (!options.base) {
                const trunk = getTrunkBranch();
                execFileSync('git', ['fetch', '--quiet', 'origin', trunk], { stdio: 'pipe' });
                base = `origin/${trunk}`;
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`❌ Could not fetch PR #${prNumber} head: ${msg}`);
            return 1;
        }
        targets = [ref];
    } else if (options.all) {
        // --all enumerates registered branches → requires an initialized registry.
        const storage = await getStorage();
        if (!(await storage.isInitialized())) {
            console.error('❌ Spidersan not initialized. Run: spidersan init');
            console.error('   (--real --all needs the registry; --real alone does not)');
            return 1;
        }
        // Reconcile-on-read: fold git truth over stale `active` status so a
        // branch already merged into trunk isn't checked for conflicts (tb-8sa.1).
        targets = activeBranches(await storage.list()).map((b) => b.name);
    } else {
        targets = [options.branch || getCurrentBranch()];
    }

    const results: RealConflictReport[] = [];
    for (const branch of targets) {
        results.push(await analyzeRealConflicts(base, branch));
    }

    const anyConflicts = results.some((r) => !r.error && !r.clean);

    if (options.json) {
        console.log(JSON.stringify({ base, results }, null, 2));
    } else {
        if (results.length === 0) {
            console.log(`🕷️ No active branches to check vs ${base}.`);
        }
        for (const report of results) {
            renderRealReport(report);
        }
    }

    return options.exitCode && anyConflicts ? 1 : 0;
}

export const conflictsCommand = new Command('conflicts')
    .description('Detect file conflicts between branches (with tiered blocking)')
    .option('--branch <name>', 'Check conflicts for specific branch')
    .option('--pr <number>', 'Check conflicts for a GitHub pull request by number')
    .option('--vs-prs', 'Also detect conflicts against other open PRs (not just registered branches)')
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
    .option('--real', 'Compute TRUE merge conflicts via git merge-tree (vs registry overlap)')
    .option('--base <ref>', 'Base/trunk ref to merge into for --real (default: detected trunk)')
    .option('--all', 'With --real: check every active registered branch')
    .option('--exit-code', 'With --real: exit 1 if any real conflicts found (like git diff)')
    .action(async (options) => {
        // ── Real (git merge-tree) conflicts ──────────────────────────────────
        // Runs BEFORE the storage-init guard: a single-target real check is pure
        // git and must work with no .spidersan/registry.json. Only --real --all
        // touches the registry, and runRealConflicts gates that path itself.
        if (options.real) {
            const code = await runRealConflicts(options);
            if (code !== 0) process.exit(code);
            return;
        }

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

        // Reconcile-on-read: branches already merged into trunk drop out before
        // overlap detection, so a stale `active` entry can't phantom-conflict (tb-8sa.1).
        const allBranches = activeBranches(await storage.list());

        // --vs-prs: pull other open PRs as conflict targets too, so two simultaneous
        // PRs touching the same files flag each other even when neither branch is in
        // the local registry. PRs become synthetic active "branches" (no agent → wake
        // skips them). Self (same headBranch) is excluded.
        // ponytail: 1 + N gh calls (list + per-PR diff); fine for typical open-PR counts,
        // parallelise if a repo ever carries hundreds of open PRs.
        if (options.vsPrs) {
            if (!isGhAvailable()) {
                console.error('⚠️  --vs-prs needs gh (unavailable/unauthenticated); checking registered branches only.');
            } else {
                const openPRs = (await listOpenPRs()).filter(pr => pr.headBranch !== targetBranch);
                const prBranches = await Promise.all(openPRs.map(async pr => ({
                    name: `PR #${pr.number} (${pr.headBranch})`,
                    files: await getPRChangedFiles(pr.number),
                    registeredAt: new Date(),
                    status: 'active' as const,
                    description: pr.title,
                })));
                allBranches.push(...prBranches.filter(b => b.files.length > 0));
            }
        }
        const conflicts: Array<{ branch: string; files: string[]; tier: number; tierInfo: ConflictTierInfo }> = [];

        // Performance Optimization: Convert target files to Set for O(1) lookup
        // Reduces complexity from O(N*M*K) to O(N*M) where N=branches, M=files/branch, K=target_files
        // Filter excluded paths (node_modules/, dist/, etc.) at query time to handle stale registrations
        const targetFilesSet = new Set(targetFiles.filter(f => !isExcludedPath(f)));

        for (const branch of allBranches) {
            if (branch.name === targetBranch || branch.status !== 'active') continue;

            // Performance Optimization: Replace .filter() with a standard loop to avoid array allocation.
            // Short-circuit using O(1) Set lookup (targetFilesSet.has) before calling the expensive isExcludedPath.
            const overlappingFiles: string[] = [];
            for (let i = 0; i < branch.files.length; i++) {
                const f = branch.files[i];
                if (targetFilesSet.has(f) && !isExcludedPath(f)) {
                    overlappingFiles.push(f);
                }
            }
            if (overlappingFiles.length > 0) {
                // Get highest tier for this conflict
                let maxTier: ConflictTierInfo = { tier: 1, label: 'WARN', icon: '🟡', action: '' };
                for (const file of overlappingFiles) {
                    const fileTier = classifyWithLabel(file, {
                        extraTier3: compiledHigh,
                        extraTier2: compiledMedium,
                    });
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

        let tier3Count = 0;
        let tier2Count = 0;
        let tier1Count = 0;

        for (const c of conflicts) {
            if (c.tier === 3) tier3Count++;
            else if (c.tier === 2) tier2Count++;
            else if (c.tier === 1) tier1Count++;
        }

        // Log conflict detection to activity log
        if (conflicts.length > 0) {
            logActivity({
                event: 'conflict_detected',
                branch: targetBranch,
                details: {
                    tier3: tier3Count,
                    tier2: tier2Count,
                    tier1: tier1Count,
                    conflicting_branches: conflicts.map(c => c.branch),
                }
            });
        }

        // Check for blocking conditions
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
                    tier1: tier1Count,
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
                const fileTier = classifyWithLabel(file, {
                    extraTier3: compiledHigh,
                    extraTier2: compiledMedium,
                });
                console.log(`   ${fileTier.icon} ${file}`);
            }
            console.log(`   → ${conflict.tierInfo.action}`);
            console.log('');
        }

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📊 Summary: 🔴 ${tier3Count} BLOCK | 🟠 ${tier2Count} PAUSE | 🟡 ${tier1Count} WARN`);

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
                console.log('  1. Send wake signal via Hub\n');

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
