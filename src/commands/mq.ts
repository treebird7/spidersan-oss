/**
 * spidersan mq — Merge queue v1.
 *
 * Reads ready PRs (label `mq:ready`), orders them, speculatively merges them onto
 * the trunk in order, runs the CI gate against the combined state, and lands the
 * PRs only if green — ejecting the culprit and retrying on red. The decision loop
 * lives in src/lib/merge-queue.ts (pure, tested); this file wires the real
 * git/gh/CI adapters. See docs/DESIGN_merge_queue_v1.md.
 *
 * Safety: a self-hosted runner runs PR code — intended for PRIVATE single-owner
 * repos only (design §10). Default mode prints the plan; pass --execute to act.
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { execGit } from '../lib/git.js';
import { isGhAvailable } from '../lib/github.js';
import { getTrunkBranch } from '../lib/trunk.js';
import { resolveRepoSlug, fetchPRHead } from './merge-plan.js';
import {
  runMergeQueue,
  type MergeQueueDeps,
  type QueuedPR,
  type SpeculativeMergeResult,
  type GateResult,
} from '../lib/merge-queue.js';

const TEMP_BRANCH = 'spidersan/mq-integration';
const DEFAULT_LABEL = 'mq:ready';
const DEFAULT_GATE = 'npm ci && npm run build && npm test';
const GATE_TIMEOUT_MS = 15 * 60 * 1000;

interface RunOptions {
  repo?: string;
  base?: string;
  label?: string;
  gateCmd?: string;
  execute?: boolean;
}

/** Read ready PRs from GitHub (label-filtered). gh has no label field in the
 *  shared client, so query the CLI directly. */
function listReadyPRs(repoSlug: string, label: string): QueuedPR[] {
  const args = [
    'pr', 'list',
    '--state', 'open',
    '--label', label,
    '--json', 'number,headRefName,title,isDraft',
    '--repo', repoSlug,
  ];
  let out: string;
  try {
    out = execFileSync('gh', args, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err) {
    throw new Error(`Failed to list PRs (label ${label}): ${err instanceof Error ? err.message : String(err)}`);
  }
  const rows = JSON.parse(out) as Array<{ number: number; headRefName: string; title: string; isDraft: boolean }>;
  return rows
    .filter((r) => !r.isDraft)
    .map((r) => ({ number: r.number, headRef: r.headRefName, title: r.title }));
}

/** Reset the integration branch to the latest trunk and merge the queue in
 *  order. Stops at the first textual conflict, ejecting that PR. */
function makeSpeculativeMerge(): MergeQueueDeps['speculativeMerge'] {
  return async (base: string, prs: QueuedPR[]): Promise<SpeculativeMergeResult> => {
    execGit(['fetch', 'origin', base]);
    execGit(['checkout', '-B', TEMP_BRANCH, `origin/${base}`]);
    const applied: QueuedPR[] = [];
    for (const pr of prs) {
      const ref = fetchPRHead(pr.number);
      if (!ref) {
        return { applied, ejected: { pr, reason: 'could not fetch PR head' } };
      }
      try {
        execGit(['merge', '--no-ff', '-m', `mq: integrate #${pr.number}`, ref]);
        applied.push(pr);
      } catch {
        try { execGit(['merge', '--abort']); } catch { /* not mid-merge */ }
        return { applied, ejected: { pr, reason: 'textual merge conflict' } };
      }
    }
    return { applied };
  };
}

function makeRunGate(gateCmd: string): MergeQueueDeps['runGate'] {
  return async (): Promise<GateResult> => {
    try {
      execFileSync('bash', ['-c', gateCmd], {
        encoding: 'utf-8',
        stdio: 'inherit',
        timeout: GATE_TIMEOUT_MS,
      });
      return { green: true };
    } catch (err) {
      return { green: false, detail: err instanceof Error ? err.message.split('\n')[0] : 'gate failed' };
    }
  };
}

function makeLandPR(repoSlug: string): MergeQueueDeps['landPR'] {
  return async (pr: QueuedPR): Promise<boolean> => {
    try {
      execFileSync('gh', ['pr', 'merge', '--squash', '--repo', repoSlug, String(pr.number)], {
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  };
}

function teardown(originalBranch: string): void {
  try { execGit(['merge', '--abort']); } catch { /* not mid-merge */ }
  try { execGit(['checkout', originalBranch]); } catch { /* best effort */ }
  try { execGit(['branch', '-D', TEMP_BRANCH]); } catch { /* may not exist */ }
}

export const mqCommand = new Command('mq')
  .description('Merge queue v1 — speculative merge + CI oracle, land if green (private repos only)');

mqCommand
  .command('run')
  .description('Order ready PRs, speculatively merge, run the CI gate, land if green')
  .option('--repo <owner/name>', 'Target repo (default: auto-detected via gh)')
  .option('--base <trunk>', 'Trunk branch (default: auto-detected)')
  .option('--label <label>', `Ready-PR label (default: ${DEFAULT_LABEL})`)
  .option('--gate-cmd <cmd>', `CI gate command (default: "${DEFAULT_GATE}")`)
  .option('--execute', 'Actually merge speculatively and land PRs (default: plan only)')
  .action(async (options: RunOptions) => {
    if (!isGhAvailable()) {
      console.error('❌ GitHub CLI (gh) not available/authenticated.');
      process.exit(1);
    }
    const repoSlug = resolveRepoSlug(options.repo);
    if (!repoSlug) {
      console.error('❌ Could not resolve repo. Pass --repo owner/name.');
      process.exit(1);
    }
    const base = options.base || getTrunkBranch();
    const label = options.label || DEFAULT_LABEL;
    const gateCmd = options.gateCmd || DEFAULT_GATE;

    const ready = listReadyPRs(repoSlug, label);
    const ordered = [...ready].sort((a, b) => a.number - b.number); // v1: oldest-first

    console.log(`🕷️  Merge queue — ${repoSlug} → ${base} (label ${label})`);
    if (ordered.length === 0) {
      console.log('   No ready PRs.');
      return;
    }
    console.log(`   Queue: ${ordered.map((p) => `#${p.number}`).join(' → ')}`);

    if (!options.execute) {
      console.log('\n   Plan only (no merges). Re-run with --execute to act.');
      console.log(`   Gate: ${gateCmd}`);
      console.log('\n   ⚠️  --execute runs PR code via the gate — private repos / trusted PRs only.');
      return;
    }

    const originalBranch = execGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    const deps: MergeQueueDeps = {
      listReadyPRs: async () => ready,
      order: (prs) => [...prs].sort((a, b) => a.number - b.number),
      speculativeMerge: makeSpeculativeMerge(),
      runGate: makeRunGate(gateCmd),
      landPR: makeLandPR(repoSlug),
      log: (m) => console.log(`   ${m}`),
    };

    try {
      const result = await runMergeQueue(deps, { base });
      console.log('\n🕷️  Result:');
      console.log(`   Landed: ${result.landed.map((p) => `#${p.number}`).join(', ') || '(none)'}`);
      if (result.ejected.length > 0) {
        console.log('   Ejected:');
        for (const e of result.ejected) console.log(`     #${e.pr.number} — ${e.reason}`);
      }
      if (!result.converged) process.exitCode = 1;
    } finally {
      teardown(originalBranch);
    }
  });

mqCommand
  .command('status')
  .description('Show the ready-PR queue and the order it would merge')
  .option('--repo <owner/name>', 'Target repo (default: auto-detected)')
  .option('--label <label>', `Ready-PR label (default: ${DEFAULT_LABEL})`)
  .action((options: { repo?: string; label?: string }) => {
    if (!isGhAvailable()) {
      console.error('❌ GitHub CLI (gh) not available/authenticated.');
      process.exit(1);
    }
    const repoSlug = resolveRepoSlug(options.repo);
    if (!repoSlug) {
      console.error('❌ Could not resolve repo. Pass --repo owner/name.');
      process.exit(1);
    }
    const label = options.label || DEFAULT_LABEL;
    const ready = listReadyPRs(repoSlug, label).sort((a, b) => a.number - b.number);
    console.log(`🕷️  Merge queue status — ${repoSlug} (label ${label})`);
    if (ready.length === 0) {
      console.log('   Queue empty.');
      return;
    }
    ready.forEach((p, i) => console.log(`   ${i + 1}. #${p.number}  ${p.title}`));
  });
