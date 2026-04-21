/**
 * Spidersan AI Setup — tier config, server probe, BYOM URL validation
 *
 * Manages ~/.spidersan/config.json (AI-specific config, separate from .spidersanrc)
 * Per spec: SPEC_spidersan_byom_telemetry.md §1.2, §1.3, §1.5, §2.1
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { HOSTED_API_BASE_URL } from './types.js';

// ─── Types ──────────────────────────────────────────────────

export type AiTier = 'free' | 'contributor' | 'byom' | 'local';

export interface AiSetupConfig {
  /** How spidersan ask routes LLM requests */
  tier: AiTier;
  /** Saved BYOM URL (only when tier=byom or explicit BYOM preference alongside hosted) */
  byomUrl?: string;
  /** User explicitly confirmed the BYOM URL is external — skip future prompts */
  byomConfirmed?: boolean;
  /** API key for hosted tier (free or contributor) */
  apiKey?: string;
  /** Whether the user has seen and responded to the consent wizard */
  consentGiven?: boolean;
  /** ISO timestamp of first setup */
  setupAt?: string;
  /** ISO timestamp of last update */
  updatedAt?: string;
}

// ─── Paths ──────────────────────────────────────────────────

const SPIDERSAN_HOME = join(homedir(), '.spidersan');
const CONFIG_PATH = join(SPIDERSAN_HOME, 'config.json');
const BYOM_AUDIT_PATH = join(SPIDERSAN_HOME, 'byom-audit.log');

// ─── Config persistence ─────────────────────────────────────

export async function loadAiConfig(): Promise<AiSetupConfig | null> {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as AiSetupConfig;
  } catch {
    return null;
  }
}

export async function saveAiConfig(config: AiSetupConfig): Promise<void> {
  await mkdir(SPIDERSAN_HOME, { recursive: true });
  const updated: AiSetupConfig = {
    ...config,
    updatedAt: new Date().toISOString(),
    setupAt: config.setupAt ?? new Date().toISOString(),
  };
  await writeFile(CONFIG_PATH, JSON.stringify(updated, null, 2), { mode: 0o600 });
}

// ─── BYOM audit log ─────────────────────────────────────────

export async function appendByomAudit(
  source: 'local_probe' | 'env_var' | 'hosted_api' | 'byom_config',
  url: string,
  confirmed: 'implicit' | 'explicit',
): Promise<void> {
  const line = `${new Date().toISOString()}  source=${source}  url=${url}  confirmed=${confirmed}\n`;
  try {
    await mkdir(SPIDERSAN_HOME, { recursive: true });
    const { appendFile } = await import('node:fs/promises');
    await appendFile(BYOM_AUDIT_PATH, line);
    // Rotate at 1 MB
    const { stat } = await import('node:fs/promises');
    const stats = await stat(BYOM_AUDIT_PATH);
    if (stats.size > 1_000_000) {
      const existing = await readFile(BYOM_AUDIT_PATH, 'utf8');
      const lines = existing.split('\n');
      // Keep last 500 lines
      await writeFile(BYOM_AUDIT_PATH, lines.slice(-500).join('\n'));
    }
  } catch {
    // Audit log failure is never fatal
  }
}

// ─── Local server probe ─────────────────────────────────────

export interface ProbeResult {
  url: string;
  port: number;
  label: string;
  responding: boolean;
  models?: string[];
}

const LOCAL_PROBE_TARGETS: Array<{ port: number; label: string }> = [
  { port: 8095, label: 'spidersan model (mlx_lm.server)' },
  { port: 8082, label: 'LM Studio (custom port)' },
  { port: 11434, label: 'Ollama' },
  { port: 1234, label: 'LM Studio (default)' },
];

export async function probeLocalServers(timeoutMs = 800): Promise<ProbeResult[]> {
  const results = await Promise.allSettled(
    LOCAL_PROBE_TARGETS.map(async ({ port, label }) => {
      const url = `http://localhost:${port}/v1/models`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timer);
        if (!res.ok) {
          return { url: `http://localhost:${port}/v1`, port, label, responding: false } as ProbeResult;
        }
        let models: string[] | undefined;
        try {
          const body = (await res.json()) as { data?: Array<{ id: string }> };
          models = body.data?.map((m) => m.id).slice(0, 3);
        } catch {
          // model list parse failure is non-fatal
        }
        return { url: `http://localhost:${port}/v1`, port, label, responding: true, models } as ProbeResult;
      } catch {
        clearTimeout(timer);
        return { url: `http://localhost:${port}/v1`, port, label, responding: false } as ProbeResult;
      }
    }),
  );
  return results.map((r) => (r.status === 'fulfilled' ? r.value : null)).filter(Boolean) as ProbeResult[];
}

/** Probe the hosted API tier. Returns a ProbeResult. */
export async function probeHostedTier(apiKey: string, timeoutMs = 2000): Promise<ProbeResult> {
  const base = HOSTED_API_BASE_URL;
  const url = `${base}/models`;
  const label = 'Hosted API (spidersan-api-proxy)';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
    clearTimeout(timer);
    if (res.status === 401) {
      return { url: base, port: 443, label, responding: false };
    }
    if (!res.ok) {
      return { url: base, port: 443, label, responding: false };
    }
    let models: string[] | undefined;
    try {
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      models = body.data?.map((m) => m.id).slice(0, 3);
    } catch {
      // non-fatal
    }
    return { url: base, port: 443, label, responding: true, models };
  } catch {
    clearTimeout(timer);
    return { url: base, port: 443, label, responding: false };
  }
}

// ─── BYOM URL classification ────────────────────────────────

export type UrlClass = 'local' | 'lan' | 'external';

const LAN_PREFIXES = ['192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.', '172.26.',
  '172.27.', '172.28.', '172.29.', '172.30.', '172.31.'];

export function classifyUrl(rawUrl: string): UrlClass {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return 'local';
    if (host.endsWith('.local')) return 'lan';
    if (LAN_PREFIXES.some((prefix) => host.startsWith(prefix))) return 'lan';
    return 'external';
  } catch {
    return 'external';
  }
}

export function isLocalOrLan(url: string): boolean {
  return classifyUrl(url) !== 'external';
}
