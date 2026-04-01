/**
 * spidersan bot — Message-driven git operations daemon via smalltoak.
 *
 * Polls smalltoak for /commands, executes git actions, replies with results.
 * Requires envoak vault injection (GIT_BOT_ENABLED=true).
 *
 * Usage:
 *   envoak vault inject --key ... -- spidersan bot
 *   spidersan bot --once
 *   spidersan bot add <name> --path <path> --branch <branch> --push <files>
 *   spidersan bot remove <name>
 *   spidersan bot repos
 */

import { Command } from 'commander';
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Config ──────────────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), '.spidersan');
const CONFIG_FILE = join(CONFIG_DIR, 'bot.json');
const HWM_FILE = join(CONFIG_DIR, 'bot_hwm');
const AGENT_NAME = 'spidersan';

const SMALLTOAK_URL = (process.env.SMALLTOAK_SERVER_URL || '').replace(/\/+$/, '');
const SMALLTOAK_TOKEN = process.env.SMALLTOAK_TOKEN || '';

const POLL_INTERVAL = 15_000;
const SYNC_INTERVAL = 90_000;
const RATE_LIMIT = 10_000; // ms per repo

const VALID_COMMANDS = new Set(['sync', 'pull', 'push', 'status', 'conflicts', 'log']);
const BRANCH_RE = /^[\w/.\-]+$/;

// ── Tiers ───────────────────────────────────────────────────────────────────

const TIERS: Record<string, { agents: string[]; commands: string[] }> = {
  coordinator: {
    agents: ['birdsan', 'bsan', 'treebird', 'trbr'],
    commands: ['sync', 'pull', 'push', 'status', 'conflicts', 'log'],
  },
  specialist: {
    agents: ['spidersan', 'ssan', 'sherlock', 'srlk', 'watsan', 'wsan',
             'treesan', 'tsan', 'mycsan', 'mycs'],
    commands: ['sync', 'pull', 'push', 'status', 'conflicts', 'log'],
  },
  worker: {
    agents: ['nemosan', 'nemo', 'codex', 'codx', 'goose', 'goos'],
    commands: ['status', 'log'],
  },
};

function getTier(sender: string): string | null {
  for (const [tier, cfg] of Object.entries(TIERS)) {
    if (cfg.agents.includes(sender)) return tier;
  }
  return null;
}

function isAuthorized(sender: string, command: string): boolean {
  const tier = getTier(sender);
  if (!tier) return false;
  return TIERS[tier].commands.includes(command);
}

// ── Bot config (bot.json) ───────────────────────────────────────────────────

interface RepoConfig {
  path: string;
  branch: string;
  autoPush: string[];
}

interface BotConfig {
  repos: Record<string, RepoConfig>;
  pollInterval: number;
  syncInterval: number;
  rateLimit: number;
}

function loadBotConfig(): BotConfig {
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    } catch { /* fall through */ }
  }
  return { repos: {}, pollInterval: 15, syncInterval: 90, rateLimit: 10 };
}

function saveBotConfig(cfg: BotConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

// ── Command parser ──────────────────────────────────────────────────────────

function parseCommand(text: string, repos: Record<string, RepoConfig>):
    { cmd: string; repo: string; args: string[] } | null {
  if (!text || !text.startsWith('/')) return null;
  const parts = text.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const cmd = parts[0].slice(1);
  const repo = parts[1];
  const args = parts.slice(2);
  if (!VALID_COMMANDS.has(cmd)) return null;
  if (!(repo in repos)) return null;
  for (const arg of args) {
    if (arg.includes("..")) return null;
    if (!BRANCH_RE.test(arg)) return null;
  }
  return { cmd, repo, args };
}

// ── Smalltoak transport ─────────────────────────────────────────────────────

async function stRead(to?: string, last?: number): Promise<any[]> {
  if (!SMALLTOAK_URL) return [];
  const params = new URLSearchParams();
  if (to) params.set('to', to);
  if (last) params.set('last', String(last));
  const qs = params.toString() ? `?${params}` : '';
  const headers: Record<string, string> = {};
  if (SMALLTOAK_TOKEN) headers['Authorization'] = `Bearer ${SMALLTOAK_TOKEN}`;
  try {
    const resp = await fetch(`${SMALLTOAK_URL}/messages${qs}`, { headers });
    if (!resp.ok) return [];
    return await resp.json() as any[];
  } catch {
    return [];
  }
}

async function stPost(text: string, to?: string, replyTo?: number): Promise<void> {
  if (!SMALLTOAK_URL) return;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (SMALLTOAK_TOKEN) headers['Authorization'] = `Bearer ${SMALLTOAK_TOKEN}`;
  try {
    await fetch(`${SMALLTOAK_URL}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text, from: AGENT_NAME, to,
        reply_to: replyTo,
      }),
    });
  } catch { /* silent */ }
}

// ── High-water mark ─────────────────────────────────────────────────────────

function loadHwm(): number {
  try { return parseInt(readFileSync(HWM_FILE, 'utf-8').trim(), 10) || 0; }
  catch { return 0; }
}

function saveHwm(id: number): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(HWM_FILE, String(id), 'utf-8');
}

// ── Git executors ───────────────────────────────────────────────────────────

// TODO: implement — the self-improve loop fills these in

function executePull(cfg: RepoConfig, branch?: string): string {
  return 'not implemented';
}

function executePush(cfg: RepoConfig): string {
  return 'not implemented';
}

function executeSync(cfg: RepoConfig): string {
  return 'not implemented';
}

function executeStatus(cfg: RepoConfig): string {
  return 'not implemented';
}

function executeLog(cfg: RepoConfig, n = 10): string {
  return 'not implemented';
}

function executeConflicts(cfg: RepoConfig): string {
  return 'not implemented';
}

// ── Rate limiter ────────────────────────────────────────────────────────────

const lastAction: Record<string, number> = {};

function rateCheck(repo: string): boolean {
  const now = Date.now();
  const last = lastAction[repo] || 0;
  if (now - last < RATE_LIMIT) return false;
  lastAction[repo] = now;
  return true;
}

// ── Command ─────────────────────────────────────────────────────────────────

export const botCommand = new Command('bot')
  .description('Message-driven git operations daemon via smalltoak')
  .option('--once', 'Single poll+sync cycle then exit')
  .action(async (opts) => {
    if (process.env.GIT_BOT_ENABLED !== 'true') {
      console.error('Error: GIT_BOT_ENABLED not set. Run via: envoak vault inject --key ... -- spidersan bot');
      process.exit(1);
    }

    const config = loadBotConfig();
    if (Object.keys(config.repos).length === 0) {
      console.error('No repos configured. Use: spidersan bot add <name> --path <path> --branch <branch> --push <files>');
      process.exit(1);
    }

    console.log(`[bot] started — ${Object.keys(config.repos).length} repos, poll=${POLL_INTERVAL / 1000}s`);

    // TODO: main loop — the self-improve loop fills this in
  });

// Sub-commands: add, remove, repos
botCommand
  .command('add <name>')
  .description('Add a repo to the bot watchlist')
  .requiredOption('--path <path>', 'Absolute path to repo')
  .requiredOption('--branch <branch>', 'Branch to track')
  .option('--push <files>', 'Comma-separated auto-push file patterns')
  .action((name, opts) => {
    const config = loadBotConfig();
    config.repos[name] = {
      path: opts.path,
      branch: opts.branch,
      autoPush: opts.push ? opts.push.split(',') : [],
    };
    saveBotConfig(config);
    console.log(`Added repo: ${name}`);
  });

botCommand
  .command('remove <name>')
  .description('Remove a repo from the bot watchlist')
  .action((name) => {
    const config = loadBotConfig();
    delete config.repos[name];
    saveBotConfig(config);
    console.log(`Removed repo: ${name}`);
  });

botCommand
  .command('repos')
  .description('List configured repos')
  .action(() => {
    const config = loadBotConfig();
    const repos = Object.entries(config.repos);
    if (repos.length === 0) {
      console.log('No repos configured.');
      return;
    }
    for (const [name, cfg] of repos) {
      console.log(`  ${name}: ${cfg.path} (${cfg.branch}) push=[${cfg.autoPush.join(', ')}]`);
    }
  });
