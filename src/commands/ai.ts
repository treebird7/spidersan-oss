/**
 * spidersan ask / advise / explain / ai-setup — AI-powered gitops reasoning
 *
 * Thin CLI wrappers over reason() from the AI core.
 * Builds context, sends to LLM (Gemma 4 default), streams response.
 */

import { createInterface } from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import { buildContext, reason, ping } from '../lib/ai/index.js';
import type { LLMProvider, ReasoningResult } from '../lib/ai/index.js';
import {
  probeLocalServers,
  probeHostedTier,
  loadAiConfig,
  saveAiConfig,
  classifyUrl,
  appendByomAudit,
} from '../lib/ai/setup.js';
import type { AiSetupConfig, AiTier } from '../lib/ai/setup.js';
import { logSession, promptOutcome } from '../lib/session-logger.js';

function printResult(result: ReasoningResult): void {
  console.log('');
  if (result.confidenceScore < 0.7) {
    console.log(chalk.yellow(`⚠  Low confidence (${(result.confidenceScore * 100).toFixed(0)}%) — review manually before acting`));
    console.log('');
  }
  console.log(result.advice);
  console.log('');
  console.log(chalk.dim(`── ${result.provider}/${result.mode} · ${result.tokensUsed} tokens · confidence: ${result.confidence} (${(result.confidenceScore * 100).toFixed(0)}%) ──`));
}

// ─── spidersan ask ──────────────────────────────────────────

export const askCommand = new Command('ask')
  .description('Ask spidersan a gitops question with full context')
  .argument('<question...>', 'Your question')
  .option('--provider <provider>', 'LLM provider (lmstudio, copilot, ollama, hosted)')
  .option('--verbose', 'Include activity log in context')
  .action(async (questionParts: string[], options: { provider?: string; verbose?: boolean }) => {
    const question = questionParts.join(' ');
    console.log(chalk.dim('🕷️  Gathering context...'));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
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
      const session_id = logSession('ask', ctx, result, { question });
      await promptOutcome(session_id, rl);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      rl.close();
    }
  });

// ─── spidersan advise ───────────────────────────────────────

export const adviseCommand = new Command('advise')
  .description('Get proactive gitops recommendations based on current state')
  .option('--provider <provider>', 'LLM provider (lmstudio, copilot, ollama, hosted)')
  .option('--verbose', 'Include activity log in context')
  .action(async (options: { provider?: string; verbose?: boolean }) => {
    console.log(chalk.dim('🕷️  Gathering context...'));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
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
      const session_id = logSession('advise', ctx, result);
      await promptOutcome(session_id, rl);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      rl.close();
    }
  });

// ─── spidersan explain ──────────────────────────────────────

export const explainCommand = new Command('explain')
  .description('Explain a branch\'s purpose, owner, status, and conflicts')
  .argument('<branch>', 'Branch name to explain')
  .option('--provider <provider>', 'LLM provider (lmstudio, copilot, ollama, hosted)')
  .action(async (branch: string, options: { provider?: string }) => {
    console.log(chalk.dim(`🕷️  Investigating ${branch}...`));

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const ctx = await buildContext({ includeActivity: true });

      console.log(chalk.dim('🧠 Analyzing...'));
      const result = await reason(
        { mode: 'explain', branch, context: ctx },
        options.provider ? { provider: options.provider as LLMProvider } : undefined,
      );

      printResult(result);
      const session_id = logSession('explain', ctx, result, { branch });
      await promptOutcome(session_id, rl);
    } catch (err) {
      console.error(`❌ ${(err as Error).message}`);
      process.exit(1);
    } finally {
      rl.close();
    }
  });

// ─── spidersan ai-ping ─────────────────────────────────────

export const aiPingCommand = new Command('ai-ping')
  .description('Check LLM provider connectivity and latency')
  .option('--provider <provider>', 'Test specific provider (lmstudio, copilot, ollama, hosted)')
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

// ─── Helpers ────────────────────────────────────────────────

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function confirmExternalByom(rl: ReturnType<typeof createInterface>, url: string): Promise<boolean> {
  console.log('');
  console.log(chalk.yellow('⚠  SPIDERSAN_LLM_URL points to an external server:'));
  console.log(chalk.yellow(`   ${url}`));
  console.log('');
  console.log('   spidersan ask sends your git context to this server:');
  console.log('   branch names, diff stats, registry state, commit structure.');
  console.log('');
  // Non-interactive stdin: default to N (safe)
  if (!process.stdin.isTTY) {
    console.log('   (Non-interactive session — defaulting to N)');
    return false;
  }
  const answer = await prompt(rl, '   Continue? [y/N] ');
  return answer.trim().toLowerCase() === 'y';
}

async function runConsentWizard(rl: ReturnType<typeof createInterface>): Promise<AiTier | null> {
  console.log('');
  console.log(chalk.dim('─────────────────────────────────────────────────────'));
  console.log('  spidersan model · first hosted API call');
  console.log(chalk.dim('─────────────────────────────────────────────────────'));
  console.log('');
  console.log('  The hosted model is free. You can help improve it.');
  console.log('');
  console.log('  If you enable the Contributor tier, each session');
  console.log('  you run sends us this structural metadata:');
  console.log('');
  console.log('    · Branch count + approximate file counts (±15%)');
  console.log('    · Branch relationships (topology, normalized)');
  console.log('    · Timing buckets (e.g. "branch open 3–14 days")');
  console.log('');
  console.log('  We never collect: file names, paths, code content,');
  console.log('  commit messages, or author information.');
  console.log('');
  console.log('  You can preview exactly what would be sent:');
  console.log('    spidersan ai preview');
  console.log('');
  console.log('  Choose your tier:');
  console.log('');
  console.log('  [C] Contributor — unlimited API calls, share metadata');
  console.log('  [F] Free        — 50 calls/day, no sharing');
  console.log('  [B] BYOM        — use your own model, skip this');
  console.log('');
  const answer = await prompt(rl, '  Choice [F]: ');
  const ch = answer.trim().toUpperCase() || 'F';
  if (ch === 'C') return 'contributor';
  if (ch === 'B') return 'byom';
  return 'free';
}

// ─── spidersan ai setup ──────────────────────────────────────

export const aiSetupCommand = new Command('ai-setup')
  .description('Set up spidersan AI — choose local model, hosted API, or BYOM')
  .option('--byom <url>', 'Directly configure a custom LLM URL (skips menu)')
  .option('--tier <tier>', 'Set tier directly: free | contributor | byom | local')
  .option('--yes', 'Skip external URL confirmation (scripted use)')
  .action(async (options: { byom?: string; tier?: string; yes?: boolean }) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    try {
      // Fast path: --byom or --tier flags
      if (options.byom ?? options.tier) {
        const existing = await loadAiConfig() ?? {} as Partial<AiSetupConfig>;
        let tier = (options.tier as AiTier | undefined) ?? existing.tier ?? 'free';
        let byomUrl: string | undefined;

        if (options.byom) {
          byomUrl = options.byom;
          tier = 'byom';
          const urlClass = classifyUrl(byomUrl);
          if (urlClass === 'external' && !options.yes) {
            const confirmed = await confirmExternalByom(rl, byomUrl);
            if (!confirmed) {
              console.log(chalk.yellow('Aborted — BYOM URL not saved.'));
              return;
            }
          }
          await appendByomAudit('byom_config', byomUrl, urlClass === 'external' ? 'explicit' : 'implicit');
        }

        await saveAiConfig({ ...existing as AiSetupConfig, tier, byomUrl, updatedAt: new Date().toISOString() });
        console.log(chalk.green(`✅ Saved: tier=${tier}${byomUrl ? ` url=${byomUrl}` : ''}`));
        return;
      }

      // Interactive setup wizard
      console.log('');
      console.log(chalk.bold('🕷️  spidersan AI setup'));
      console.log('');
      console.log(chalk.dim('Detecting local LLM servers...'));

      const probeResults = await probeLocalServers();
      const localServers = probeResults.filter((r) => r.responding);

      // Build menu
      const menuItems: Array<{ label: string; tier: AiTier; byomUrl?: string }> = [];

      if (localServers.length > 0) {
        const s = localServers[0]!;
        const modelHint = s.models?.[0] ? ` · ${s.models[0]}` : '';
        menuItems.push({
          label: `Local model (${s.label} at localhost:${s.port}${modelHint}) — already detected`,
          tier: 'local',
          byomUrl: s.url,
        });
      } else {
        menuItems.push({
          label: `Set up a local LLM server — see docs.spidersan.dev/local-setup`,
          tier: 'local',
        });
      }

      menuItems.push({ label: 'Hosted API — free tier, 50 calls/day (requires API key from spidersan.dev)', tier: 'free' });
      menuItems.push({ label: 'Hosted API — Contributor tier (unlimited, share anonymized sessions)', tier: 'contributor' });
      menuItems.push({ label: 'Custom URL (BYOM)', tier: 'byom' });

      if (localServers.length > 0) {
        localServers.forEach((s) => {
          console.log(chalk.green(`  ✓ Found: ${s.label} at localhost:${s.port}`));
        });
      } else {
        console.log(chalk.dim('  No local servers detected'));
      }

      console.log('');
      console.log('How would you like to use spidersan ask?');
      console.log('');
      menuItems.forEach((item, i) => {
        console.log(`  [${i + 1}] ${item.label}`);
      });
      console.log('');

      const defaultChoice = '1';
      const raw = await prompt(rl, `Choice [${defaultChoice}]: `);
      const choice = parseInt(raw.trim() || defaultChoice, 10);

      if (isNaN(choice) || choice < 1 || choice > menuItems.length) {
        console.log(chalk.red('Invalid choice.'));
        rl.close();
        process.exit(1);
        return;
      }

      const selected = menuItems[choice - 1]!;
      const finalConfig: AiSetupConfig = {
        tier: selected.tier,
        byomUrl: selected.byomUrl,
        consentGiven: false,
      };

      // BYOM: collect and validate URL
      if (selected.tier === 'byom') {
        const rawUrl = await prompt(rl, '  Custom LLM URL: ');
        const trimmedUrl = rawUrl.trim();
        if (!trimmedUrl) {
          console.log(chalk.red('No URL provided.'));
          process.exitCode = 1;
          return;
        }

        const urlClass = classifyUrl(trimmedUrl);
        if (urlClass === 'external' && !options.yes) {
          const confirmed = await confirmExternalByom(rl, trimmedUrl);
          if (!confirmed) {
            console.log(chalk.yellow('Aborted — BYOM URL not saved.'));
            return;
          }
          finalConfig.byomConfirmed = true;
        }
        finalConfig.byomUrl = trimmedUrl;
        await appendByomAudit('byom_config', trimmedUrl, urlClass === 'external' ? 'explicit' : 'implicit');
      }

      // Local: save probed URL; show it works immediately
      if (selected.tier === 'local' && selected.byomUrl) {
        await appendByomAudit('local_probe', selected.byomUrl, 'implicit');
      }

      // Contributor tier: show what's shared
      if (selected.tier === 'contributor') {
        const tier = await runConsentWizard(rl);
        if (tier === 'byom') {
          // user bailed to BYOM during consent — redirect
          console.log(chalk.dim('  Switching to BYOM setup. Run: spidersan ai-setup --byom <url>'));
          return;
        }
        finalConfig.tier = tier ?? 'free';
        finalConfig.consentGiven = true;
      }

      // Hosted free or contributor: collect and validate API key
      if (finalConfig.tier === 'free' || finalConfig.tier === 'contributor') {
        const existing = await loadAiConfig();
        const existingKey = existing?.apiKey ?? process.env['SPIDERSAN_API_KEY'];

        if (existingKey) {
          console.log(chalk.dim('  API key already configured — validating...'));
          const probe = await probeHostedTier(existingKey);
          if (probe.responding) {
            console.log(chalk.green('  ✓ Hosted API reachable'));
            const modelHint = probe.models?.[0] ? ` (${probe.models[0]})` : '';
            console.log(chalk.dim(`    ${probe.url}${modelHint}`));
            finalConfig.apiKey = existingKey;
          } else {
            console.log(chalk.yellow('  ⚠  Existing API key validation failed — enter a new key or press Enter to skip'));
            const rawKey = await prompt(rl, '  API key (from spidersan.dev/keys): ');
            const trimmedKey = rawKey.trim();
            if (trimmedKey) {
              finalConfig.apiKey = trimmedKey;
            }
          }
        } else {
          console.log('');
          console.log('  Get a free API key at: https://spidersan.dev/keys');
          console.log('');
          const rawKey = await prompt(rl, '  API key (press Enter to skip for now): ');
          const trimmedKey = rawKey.trim();
          if (trimmedKey) {
            console.log(chalk.dim('  Validating...'));
            const probe = await probeHostedTier(trimmedKey);
            if (probe.responding) {
              const modelHint = probe.models?.[0] ? ` · model: ${probe.models[0]}` : '';
              console.log(chalk.green(`  ✓ Hosted API reachable${modelHint}`));
              finalConfig.apiKey = trimmedKey;
            } else {
              console.log(chalk.yellow('  ⚠  Could not validate key (API unreachable or key invalid) — saved anyway'));
              finalConfig.apiKey = trimmedKey;
            }
          } else {
            console.log(chalk.dim('  Skipped — you can add it later with: spidersan ai-setup --tier free'));
          }
        }
        finalConfig.consentGiven = finalConfig.tier === 'contributor' ? true : false;
      }

      // Hosted free: show consent wizard first time (override consentGiven set above)
      if (selected.tier === 'free') {
        finalConfig.consentGiven = false; // will prompt on first `ask` invocation
      }

      await saveAiConfig(finalConfig);

      console.log('');
      console.log(chalk.green('✅ Configuration saved to ~/.spidersan/config.json'));
      console.log('');

      if (finalConfig.tier === 'local' && finalConfig.byomUrl) {
        console.log(`   Using: ${finalConfig.byomUrl}`);
        console.log(`   Try it: ${chalk.bold('spidersan ask "what branches are ready to merge?"')}`);
      } else if (finalConfig.tier === 'contributor') {
        console.log('   Tier: Contributor (unlimited API calls)');
        console.log('   Preview what you share: spidersan ai preview');
        console.log(`   Try it: ${chalk.bold('spidersan ask "what branches are ready to merge?"')}`);
      } else if (finalConfig.tier === 'free') {
        console.log('   Tier: Free (50 calls/day)');
        console.log('   Upgrade anytime: spidersan ai-setup --tier contributor');
        console.log(`   Try it: ${chalk.bold('spidersan ask "what branches are ready to merge?"')}`);
      } else if (finalConfig.tier === 'byom') {
        console.log(`   Using: ${finalConfig.byomUrl}`);
        console.log(`   Try it: ${chalk.bold('spidersan ask "what branches are ready to merge?"')}`);
      }
      console.log('');
    } finally {
      rl.close();
    }
  });

// ─── spidersan ai telemetry ──────────────────────────────────

export const aiTelemetryCommand = new Command('ai-telemetry')
  .description('View or change your spidersan AI tier (free/contributor/byom/local)')
  .argument('[setting]', 'on | off | contributor | free | byom | local | status')
  .action(async (setting: string | undefined) => {
    const config = await loadAiConfig();

    if (!setting || setting === 'status') {
      if (!config) {
        console.log(chalk.dim('No AI config found. Run: spidersan ai-setup'));
        return;
      }
      console.log('');
      console.log(`  Tier:    ${chalk.bold(config.tier)}`);
      if (config.byomUrl) console.log(`  BYOM:    ${config.byomUrl}`);
      if (config.updatedAt) console.log(`  Updated: ${config.updatedAt}`);
      console.log('');
      return;
    }

    const existing = config ?? {} as Partial<AiSetupConfig>;
    let newTier: AiTier;

    if (setting === 'on' || setting === 'contributor') newTier = 'contributor';
    else if (setting === 'off' || setting === 'free') newTier = 'free';
    else if (setting === 'byom') newTier = 'byom';
    else if (setting === 'local') newTier = 'local';
    else {
      console.log(chalk.red(`Unknown setting: ${setting}. Use: on | off | contributor | free | byom | local`));
      process.exit(1);
      return;
    }

    await saveAiConfig({ ...existing as AiSetupConfig, tier: newTier });
    console.log(chalk.green(`✅ Tier set to: ${newTier}`));
  });


// ─── spidersan check-opt-out ─────────────────────────────────
// Used by archaeology pipeline to check repo opt-out status before mining

export const checkOptOutCommand = new Command('check-opt-out')
  .description('Check if a repository is in the archaeology opt-out registry')
  .argument('<repo>', 'Repository URL or owner/name (e.g. github.com/owner/repo)')
  .option('--registry <url>', 'Registry URL', 'https://spidersan.dev/archaeology-opt-out')
  .option('--json', 'Output JSON')
  .action(async (repo: string, options: { registry: string; json?: boolean }) => {
    const query = repo.startsWith('http') ? repo : `https://github.com/${repo}`;
    const url = `${options.registry}?repo=${encodeURIComponent(query)}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`Registry returned ${res.status}`);
      const data = await res.json() as { repo: string; opted_out: boolean; added_at: string | null };

      if (options.json) {
        console.log(JSON.stringify(data));
        return;
      }

      if (data.opted_out) {
        console.log(chalk.yellow(`⚠  ${repo} is opted out (since ${data.added_at ?? 'unknown'})`));
        process.exitCode = 1; // non-zero so pipeline scripts can detect
      } else {
        console.log(chalk.green(`✓  ${repo} is not opted out — clear for archaeology`));
      }
    } catch (err) {
      console.error(chalk.red(`❌ Registry check failed: ${(err as Error).message}`));
      console.error(chalk.dim('   Defaulting to: NOT opted out (registry unreachable)'));
      // Fail open — registry being down should not block archaeology
    }
  });
