/**
 * spidersan context — Show aggregated repository context
 *
 * Thin CLI wrapper over buildContext() from the AI core.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { buildContext } from '../lib/ai/index.js';
import type { SpiderContext } from '../lib/ai/index.js';

function formatContext(ctx: SpiderContext, verbose: boolean): string {
  const lines: string[] = [];

  lines.push(chalk.bold('🕷️  Spidersan Context'));
  lines.push(chalk.dim(`   ${ctx.timestamp}`));
  lines.push('');

  // Git
  lines.push(chalk.bold('📂 Repository'));
  lines.push(`   ${ctx.repo} → ${chalk.cyan(ctx.branch)}`);
  const gitParts: string[] = [];
  if (ctx.gitStatus.ahead > 0) gitParts.push(chalk.green(`↑${ctx.gitStatus.ahead}`));
  if (ctx.gitStatus.behind > 0) gitParts.push(chalk.red(`↓${ctx.gitStatus.behind}`));
  if (ctx.gitStatus.dirty.length > 0) gitParts.push(chalk.yellow(`${ctx.gitStatus.dirty.length} dirty`));
  if (gitParts.length > 0) lines.push(`   ${gitParts.join(' · ')}`);
  lines.push('');

  // Registry
  lines.push(chalk.bold('🕸️  Registry'));
  lines.push(`   ${ctx.registry.active} active · ${ctx.registry.stale} stale`);
  if (verbose && ctx.registry.branches.length > 0) {
    for (const b of ctx.registry.branches) {
      const icon = b.status === 'active' ? '🔄' : b.status === 'merged' || b.status === 'completed' ? '✅' : '❌';
      lines.push(`   ${icon} ${b.name} ${chalk.dim(b.agent ?? '')} [${b.files.length} files]`);
    }
  }
  lines.push('');

  // Conflicts
  const totalConflicts = ctx.conflicts.tier1 + ctx.conflicts.tier2 + ctx.conflicts.tier3;
  if (totalConflicts > 0) {
    lines.push(chalk.bold('⚔️  Conflicts'));
    if (ctx.conflicts.tier3 > 0) lines.push(`   ${chalk.red(`🔴 TIER 3 BLOCK: ${ctx.conflicts.tier3}`)}`);
    if (ctx.conflicts.tier2 > 0) lines.push(`   ${chalk.yellow(`🟠 TIER 2 PAUSE: ${ctx.conflicts.tier2}`)}`);
    if (ctx.conflicts.tier1 > 0) lines.push(`   ${chalk.dim(`🟡 TIER 1 WARN: ${ctx.conflicts.tier1}`)}`);
    if (verbose) {
      for (const c of ctx.conflicts.details) {
        lines.push(`   TIER ${c.tier}: ${c.branch} ↔ ${c.otherBranch} on [${c.files.join(', ')}]`);
      }
    }
  } else {
    lines.push(chalk.bold('⚔️  Conflicts') + chalk.green(' ✅ none'));
  }
  lines.push('');

  // Colony
  lines.push(chalk.bold('🍄 Colony'));
  if (ctx.colony.online) {
    lines.push(`   Online · ${ctx.colony.activeAgents.length} agents: ${ctx.colony.activeAgents.join(', ') || 'none'}`);
    if (verbose && ctx.colony.inProgress.length > 0) {
      for (const w of ctx.colony.inProgress) {
        lines.push(`   ${w.agent}: ${w.task} (${w.status})`);
      }
    }
  } else {
    lines.push(chalk.dim('   Offline'));
  }

  // Activity
  if (verbose && ctx.activityLog && ctx.activityLog.length > 0) {
    lines.push('');
    lines.push(chalk.bold('📋 Recent Activity'));
    for (const a of ctx.activityLog.slice(0, 10)) {
      lines.push(`   [${a.event}] ${a.branch ?? ''} by ${a.agent ?? 'unknown'}`);
    }
  }

  return lines.join('\n');
}

export const contextCommand = new Command('context')
  .description('Show aggregated repository context (registry, conflicts, git, colony)')
  .option('--json', 'Output as structured JSON')
  .option('--verbose', 'Include all sections (activity log, branch details)')
  .option('--repo <path>', 'Target a specific repository path')
  .action(async (options: { json?: boolean; verbose?: boolean; repo?: string }) => {
    try {
      const ctx = await buildContext({
        repoRoot: options.repo,
        includeActivity: options.verbose,
        verbose: options.verbose,
      });

      if (options.json) {
        console.log(JSON.stringify(ctx, null, 2));
      } else {
        console.log(formatContext(ctx, options.verbose ?? false));
      }
    } catch (err) {
      console.error(`❌ Failed to build context: ${(err as Error).message}`);
      process.exit(1);
    }
  });
