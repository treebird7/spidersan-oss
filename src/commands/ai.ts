/**
 * spidersan ask / advise / explain — AI-powered gitops reasoning
 *
 * Thin CLI wrappers over reason() from the AI core.
 * Builds context, sends to LLM (Gemma 4 default), streams response.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { buildContext, reason, ping } from '../lib/ai/index.js';
import type { LLMProvider, ReasoningResult } from '../lib/ai/index.js';

function printResult(result: ReasoningResult): void {
  console.log('');
  console.log(result.advice);
  console.log('');
  console.log(chalk.dim(`── ${result.provider}/${result.mode} · ${result.tokensUsed} tokens · confidence: ${result.confidence} ──`));
}

// ─── spidersan ask ──────────────────────────────────────────

export const askCommand = new Command('ask')
  .description('Ask spidersan a gitops question with full context')
  .argument('<question...>', 'Your question')
  .option('--provider <provider>', 'LLM provider (lmstudio, copilot, ollama)')
  .option('--verbose', 'Include activity log in context')
  .action(async (questionParts: string[], options: { provider?: string; verbose?: boolean }) => {
    const question = questionParts.join(' ');
    console.log(chalk.dim('🕷️  Gathering context...'));

    try {
      const ctx = await buildContext({
        includeActivity: options.verbose ?? true,
        verbose: options.verbose,
      });

      console.log(chalk.dim('🧠 Reasoning...'));
      const result = await reason(
        { mode: 'ask', question, context: ctx, verbose: options.verbose },
        options.provider ? { provider: options.provider as LLMProvider } : undefined,
      );

      printResult(result);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── spidersan advise ───────────────────────────────────────

export const adviseCommand = new Command('advise')
  .description('Get proactive gitops recommendations based on current state')
  .option('--provider <provider>', 'LLM provider (lmstudio, copilot, ollama)')
  .option('--verbose', 'Include activity log in context')
  .action(async (options: { provider?: string; verbose?: boolean }) => {
    console.log(chalk.dim('🕷️  Gathering context...'));

    try {
      const ctx = await buildContext({
        includeActivity: true,
        verbose: options.verbose,
      });

      console.log(chalk.dim('🧠 Analyzing...'));
      const result = await reason(
        { mode: 'advise', context: ctx, verbose: options.verbose },
        options.provider ? { provider: options.provider as LLMProvider } : undefined,
      );

      printResult(result);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── spidersan explain ──────────────────────────────────────

export const explainCommand = new Command('explain')
  .description('Explain a branch\'s purpose, owner, status, and conflicts')
  .argument('<branch>', 'Branch name to explain')
  .option('--provider <provider>', 'LLM provider (lmstudio, copilot, ollama)')
  .action(async (branch: string, options: { provider?: string }) => {
    console.log(chalk.dim(`🕷️  Investigating ${branch}...`));

    try {
      const ctx = await buildContext({ includeActivity: true });

      console.log(chalk.dim('🧠 Analyzing...'));
      const result = await reason(
        { mode: 'explain', branch, context: ctx },
        options.provider ? { provider: options.provider as LLMProvider } : undefined,
      );

      printResult(result);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ─── spidersan ai-ping ─────────────────────────────────────

export const aiPingCommand = new Command('ai-ping')
  .description('Check LLM provider connectivity and latency')
  .option('--provider <provider>', 'Test specific provider (lmstudio, copilot, ollama)')
  .action(async (options: { provider?: string }) => {
    console.log(chalk.dim('🕷️  Pinging LLM...'));

    const result = await ping(
      options.provider ? { provider: options.provider as LLMProvider } : undefined,
    );

    if (result.ok) {
      console.log(chalk.green(`✅ ${result.provider}/${result.model} — ${result.latencyMs}ms`));
    } else {
      console.log(chalk.red(`❌ ${result.provider}/${result.model} — ${result.error}`));
      process.exit(1);
    }
  });
