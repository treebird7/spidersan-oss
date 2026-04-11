/**
 * spidersan queen
 *
 * Mode 3: Queen Spider — sub-spidersan dispatch for parallel ground jobs.
 *
 * The queen never does ground work. It spawns scoped, ephemeral sub-spidersans,
 * watches them via the colony gradient, and integrates results. Each sub fires,
 * completes its single job, and dissolves back into the colony.
 *
 * Subcommands:
 *   spawn    — define a ground job, emit colony assignment, print launch script
 *   status   — show active sub-spidersans spawned by this queen signal
 *   dissolve — manually close a stuck sub-spidersan
 *
 * Colony shape:
 *   Queen emits a signal (status=in-progress, type=work_claim, task="queen dispatch")
 *   Each sub emits a signal with payload.spawned_by = queen_signal_id
 *   Sub closes via colony_close on completion (fire-complete-dissolve)
 *
 * Note: Actual claude spawning (via nanoclaw/INFRA-A) is stubbed until Phase 0
 * is proven. spawn prints the launch script — execution is manual or via birdsan.
 */

import { Command } from 'commander';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import { writeFileSync, mkdtempSync } from 'fs';
import { escapeShellString } from '../lib/security.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type GroundJobType = 'sync' | 'conflicts' | 'cleanup' | 'custom';

interface SpawnOptions {
    repos?: string;
    task: string;
    type: GroundJobType;
    keyId?: string;
    dryRun?: boolean;
    json?: boolean;
}

interface StatusOptions {
    queenSignalId?: string;
    json?: boolean;
}

interface DissolveOptions {
    summary?: string;
    dryRun?: boolean;
}

interface ColonySignalRow {
    id: string;
    status: string;
    task?: string;
    summary?: string;
    payload?: Record<string, unknown> | null;
    createdAt?: string;
    updatedAt?: string;
    isStale?: boolean;
}

interface ColonyStateResponse {
    signals?: ColonySignalRow[];
    gradient?: ColonySignalRow[];  // legacy alias
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveRepos(reposOption?: string): string[] {
    if (reposOption) {
        return reposOption.split(',').map((r) => r.trim()).filter(Boolean);
    }
    const envRepos = process.env['SPIDERSAN_REPOS'];
    if (envRepos) {
        return envRepos.split(':').map((r) => r.trim()).filter(Boolean);
    }
    const homeDir = process.env.HOME || os.homedir();
    return [
        `${homeDir}/Dev/Envoak`,
        `${homeDir}/Dev/treebird-internal`,
        `${homeDir}/Dev/spidersan`,
        `${homeDir}/Dev/Toak`,
        `${homeDir}/Dev/flockview`,
        `${homeDir}/Dev/mappersan`,
    ];
}

/**
 * Emit a queen colony signal and return its ID.
 * Returns null on failure (envoak not available / vault expired).
 */
function emitQueenSignal(task: string, repos: string[]): string | null {
    const summary =
        `Queen Spider dispatching ${repos.length} ground job(s): ` +
        repos.map((r) => path.basename(r)).join(', ');

    const result = spawnSync(
        'envoak',
        [
            'colony', 'signal',
            '--status', 'in-progress',
            '--task', task,
            '--summary', summary,
        ],
        { encoding: 'utf-8', timeout: 15000 },
    );

    if (result.status !== 0) {
        console.error(`[QUEEN] Failed to emit colony signal: ${result.stderr ?? result.stdout}`);
        return null;
    }

    // Parse signal ID directly from "Signal emitted (id: UUID)" in stdout
    const match = (result.stdout ?? '').match(/Signal emitted \(id:\s*([\w-]+)\)/);
    if (match?.[1]) return match[1];

    // Fallback: query the colony gradient for the latest in-progress signal with this task
    try {
        const statusResult = spawnSync(
            'envoak',
            ['colony', 'status', '--json'],
            { encoding: 'utf-8', timeout: 10000 },
        );
        if (statusResult.stdout) {
            const data = JSON.parse(statusResult.stdout) as ColonyStateResponse;
            const gradient = data.signals ?? data.gradient ?? [];
            const latest = gradient.find(
                (s) => s.task === task && s.status === 'in-progress',
            );
            if (latest) return latest.id;
        }
    } catch {
        /* ignore — signal was emitted, ID lookup failed */
    }
    return null;
}

/**
 * Build the ground job script for a sub-spidersan.
 * Returns the shell script string to be printed or written to a file.
 */
function buildGroundJobScript(
    repo: string,
    task: string,
    jobType: GroundJobType,
    queenSignalId: string | null,
): string {
    const repoName = path.basename(repo);

    // Security: Escape user inputs to prevent command injection in generated bash script
    const safeRepo = escapeShellString(repo);
    const safeTask = escapeShellString(`${task} [${repoName}]`);
    const safeQueenSignalId = escapeShellString(queenSignalId ?? '');
    const safeRepoName = escapeShellString(repoName);
    const safeSummaryStart = escapeShellString(`Sub-spidersan started in ${repoName}.`);
    const safeSummarySuccess = escapeShellString(`Ground job complete: ${task} [${repoName}] — success.`);

    // We use variables for these strings inside the script to avoid complex escaping
    const priorFlag = queenSignalId
        ? `\n  --prior-signal-id "$QUEEN_SIGNAL_ID" \\`
        : '';

    const jobCommands: Record<GroundJobType, string> = {
        sync: `  # GROUND JOB: sync
  git pull origin main --rebase 2>&1 | tail -3
  spidersan pulse --quiet`,
        conflicts: `  # GROUND JOB: conflict scan
  spidersan conflicts --json --tier 1 > /tmp/ssan-conflicts-"$REPO_NAME_VAR".json
  cat /tmp/ssan-conflicts-"$REPO_NAME_VAR".json | jq '.summary'`,
        cleanup: `  # GROUND JOB: stale cleanup
  spidersan stale
  envoak colony gc`,
        custom: `  # GROUND JOB: custom — replace this with your commands
  echo "Custom job in $REPO_NAME_VAR"`,
    };

    return `#!/usr/bin/env bash
# Sub-spidersan ground job
# Generated by: spidersan queen spawn
# Fire-complete-dissolve pattern — run, emit result, exit.

set -euo pipefail

REPO=${safeRepo}
TASK=${safeTask}
QUEEN_SIGNAL_ID=${safeQueenSignalId}
REPO_NAME_VAR=${safeRepoName}
SUMMARY_START=${safeSummaryStart}
SUMMARY_SUCCESS=${safeSummarySuccess}

cd "$REPO"

# ── Enlist ────────────────────────────────────────────────────────────────────
envoak colony signal \\
  --status in-progress \\
  --task "$TASK" \\
  --summary "$SUMMARY_START" \\${priorFlag}
  || true  # non-fatal if vault expired

# ── Ground job ────────────────────────────────────────────────────────────────
${jobCommands[jobType]}
RESULT=$?

# ── Dissolve ──────────────────────────────────────────────────────────────────
if [ $RESULT -eq 0 ]; then
  envoak colony close \\
    --summary "$SUMMARY_SUCCESS" \\
    || true
  echo "[SUB-SSAN] ✅ Done: $REPO_NAME_VAR"
else
  # Using bash parameter expansion for the failure summary to inject the exit code safely
  SUMMARY_FAIL="Ground job failed in $REPO_NAME_VAR (exit $RESULT). Queen: \${QUEEN_SIGNAL_ID:-unknown}."
  envoak colony signal \\
    --status blocked \\
    --task "$TASK" \\
    --summary "$SUMMARY_FAIL" \\
    || true
  envoak colony close --summary "Ground job failed — see blocked signal." || true
  echo "[SUB-SSAN] ❌ Failed: $REPO_NAME_VAR (exit $RESULT)"
fi
`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

const queenSpawnCommand = new Command('spawn')
    .description('Dispatch sub-spidersans for parallel ground jobs')
    .requiredOption('-t, --task <description>', 'One-line description of the ground job')
    .option('--type <type>', 'Job type: sync | conflicts | cleanup | custom (default: sync)', 'sync')
    .option('--repos <paths>', 'Comma-separated repo paths (default: ecosystem repos)')
    .option('--key-id <uuid>', 'Agent key ID to include in colony signal')
    .option('--dry-run', 'Print job scripts without emitting colony signals')
    .option('--json', 'Output job manifest as JSON')
    .action(async (options: SpawnOptions) => {
        const repos = resolveRepos(options.repos);
        const jobType = (options.type as GroundJobType) ?? 'sync';
        const dryRun = options.dryRun ?? false;

        console.log(`
🕷️  QUEEN SPIDER — SPAWNING ${repos.length} SUB-SPIDERSAN(S)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Task:     ${options.task}
Job type: ${jobType}
Repos:    ${repos.map((r) => path.basename(r)).join(', ')}
Dry-run:  ${dryRun}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

        // Emit queen signal (skip in dry-run)
        let queenSignalId: string | null = null;
        if (!dryRun) {
            queenSignalId = emitQueenSignal(options.task, repos);
            if (queenSignalId) {
                console.log(`[QUEEN] Signal emitted: ${queenSignalId}`);
            } else {
                console.warn('[QUEEN] Could not retrieve queen signal ID — sub-spidersans will have no prior_signal_id.');
            }
        } else {
            queenSignalId = 'DRY-RUN-QUEEN-SIGNAL';
        }

        // Generate job scripts
        let scriptDir = path.join(os.tmpdir(), `ssan-queen-dryrun`);
        if (!dryRun) {
            scriptDir = mkdtempSync(path.join(os.tmpdir(), 'ssan-queen-'));
        }

        const manifest: Array<{ repo: string; script: string; queenSignalId: string | null }> = [];

        for (const repo of repos) {
            const script = buildGroundJobScript(repo, options.task, jobType, queenSignalId);
            const repoName = path.basename(repo);
            const scriptPath = path.join(scriptDir, `sub-ssan-${repoName}.sh`);

            if (!dryRun) {
                try {
                    writeFileSync(scriptPath, script, { mode: 0o755 });
                } catch {
                    /* non-fatal */
                }
            }

            manifest.push({ repo, script: scriptPath, queenSignalId });

            console.log(`\n── Sub-spidersan: ${repoName} ──`);
            if (dryRun) {
                console.log(script);
            } else {
                console.log(`  Script: ${scriptPath}`);
                console.log(`  Run:    bash "${scriptPath}"`);
            }
        }

        if (!dryRun && manifest.length > 0) {
            console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[QUEEN] ${repos.length} job script(s) written to ${scriptDir}
[QUEEN] Run all in parallel:

  for f in ${scriptDir}/sub-ssan-*.sh; do bash "$f" & done; wait

[QUEEN] Monitor via: spidersan queen status --queen-signal-id ${queenSignalId ?? '<id>'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        }

        if (options.json) {
            console.log(JSON.stringify({ queenSignalId, repos, jobType, task: options.task, scripts: manifest.map((m) => m.script) }, null, 2));
        }
    });

const queenStatusCommand = new Command('status')
    .description('Show active sub-spidersans spawned by this queen signal')
    .option('--queen-signal-id <id>', 'Queen signal ID to filter by (reads colony gradient)')
    .option('--json', 'Output as JSON')
    .action(async (options: StatusOptions) => {
        const result = spawnSync(
            'envoak',
            ['colony', 'status', '--json'],
            { encoding: 'utf-8', timeout: 10000 },
        );

        if (result.status !== 0 || !result.stdout) {
            console.error('[QUEEN] Failed to read colony gradient');
            process.exit(1);
        }

        let data: ColonyStateResponse = {};
        try {
            const parsed = JSON.parse(result.stdout) as ColonyStateResponse;
            data = parsed;
        } catch {
            console.error('[QUEEN] Failed to parse colony gradient JSON');
            process.exit(1);
        }

        // Filter to sub-spidersans: signals where payload.spawned_by matches queen signal ID
        const gradient = data.signals ?? data.gradient ?? [];
        const subs = gradient.filter((s) => {
            if (!options.queenSignalId) {
                // No filter — show all signals with a spawned_by field
                return s.payload && typeof s.payload === 'object' && 'spawned_by' in s.payload;
            }
            return (
                s.payload &&
                typeof s.payload === 'object' &&
                s.payload['spawned_by'] === options.queenSignalId
            );
        });

        if (options.json) {
            console.log(JSON.stringify({ queenSignalId: options.queenSignalId ?? null, subs }, null, 2));
            return;
        }

        console.log(`
🕷️  QUEEN STATUS${options.queenSignalId ? ` (queen: ${options.queenSignalId.slice(0, 8)})` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Active sub-spidersans: ${subs.length}
`);

        if (subs.length === 0) {
            console.log('  No active sub-spidersans found.');
            console.log('  (Sub-spidersans dissolve after completing their ground job.)');
            return;
        }

        for (const sub of subs) {
            const staleFlag = sub.isStale ? ' ⚠️ STALE' : '';
            console.log(`  ${sub.status.padEnd(12)} ${sub.task ?? '(no task)'}${staleFlag}`);
            if (sub.summary) console.log(`               ${sub.summary}`);
        }
    });

const queenDissolveCommand = new Command('dissolve')
    .description('Manually close a stuck sub-spidersan session')
    .argument('<signal-id>', 'Signal ID of the stuck sub-spidersan')
    .option('--summary <text>', 'Dissolution summary', 'Manually dissolved by queen spider.')
    .option('--dry-run', 'Print what would happen without acting')
    .action(async (signalId: string, options: DissolveOptions) => {
        if (options.dryRun) {
            console.log(`[DRY-RUN] Would emit blocked signal for ${signalId} then close session.`);
            return;
        }

        console.log(`[QUEEN] Dissolving sub-spidersan ${signalId.slice(0, 8)}...`);

        // Emit a blocked signal to mark it, then it can be GC'd
        const result = spawnSync(
            'envoak',
            [
                'colony', 'signal',
                '--status', 'blocked',
                '--task', 'sub-spidersan dissolved',
                '--summary', options.summary ?? 'Manually dissolved by queen spider.',
                '--prior-signal-id', signalId,
            ],
            { encoding: 'utf-8', timeout: 10000 },
        );

        if (result.status === 0) {
            console.log(`[QUEEN] ✅ Dissolution signal emitted. Run 'envoak colony gc' to clean up.`);
        } else {
            console.error(`[QUEEN] Failed to emit dissolution signal: ${result.stderr ?? result.stdout}`);
            process.exit(1);
        }
    });

export const queenCommand = new Command('queen')
    .description('Mode 3: Queen Spider — dispatch sub-spidersans for parallel ground jobs')
    .addCommand(queenSpawnCommand)
    .addCommand(queenStatusCommand)
    .addCommand(queenDissolveCommand);
