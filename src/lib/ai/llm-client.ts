/**
 * Spidersan AI Core — LLM Client
 *
 * Unified interface for LLM providers with automatic fallback chain:
 * LM Studio (Gemma 4) → Ollama → Hosted API (api.spidersan.dev) → GitHub Copilot
 *
 * Tier routing (auto, no explicit provider):
 *   Tier 1: localhost:1234 / :8082 (lmstudio)
 *   Tier 2: localhost:11434 (ollama)
 *   Tier 3: api.spidersan.dev (hosted) — requires API key
 *   Remote: copilot — only with allowRemoteFallback or explicit config
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LLMConfig, LLMMessage, LLMProvider, LLMResponse } from './types.js';
import { DEFAULT_LLM_CONFIGS } from './types.js';
import { loadAiConfig } from './setup.js';

const execFileAsync = promisify(execFile);

export function resolveConfig(overrides?: Partial<LLMConfig>): LLMConfig {
  const providerEnv = process.env['SPIDERSAN_LLM'] as LLMProvider | undefined;
  const provider = overrides?.provider ?? providerEnv ?? 'lmstudio';
  const base = DEFAULT_LLM_CONFIGS[provider] ?? DEFAULT_LLM_CONFIGS.lmstudio;

  return {
    ...base,
    ...overrides,
    provider,
    model: overrides?.model ?? process.env['SPIDERSAN_LLM_MODEL'] ?? base.model,
    baseUrl: overrides?.baseUrl ?? process.env['SPIDERSAN_LLM_URL'] ?? base.baseUrl,
  };
}

async function getGitHubToken(): Promise<string> {
  try {
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 5000 });
    return stdout.trim();
  } catch {
    throw new Error('GitHub CLI not authenticated. Run `gh auth login` first.');
  }
}

async function chatOpenAICompatible(
  config: LLMConfig,
  messages: LLMMessage[],
  apiKey?: string,
): Promise<LLMResponse> {
  // Normalize: strip trailing /v1 so we always build the full path ourselves.
  // Handles both http://host:port (env var form) and http://host:port/v1 (default form).
  const base = config.baseUrl.replace(/\/v1\/?$/, '');
  const url = `${base}/v1/chat/completions`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`LLM ${config.provider} returned ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    choices: Array<{ message: { content: string } }>;
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    content: data.choices[0]?.message?.content ?? '',
    model: data.model ?? config.model,
    provider: config.provider,
    promptTokens: data.usage?.prompt_tokens ?? 0,
    completionTokens: data.usage?.completion_tokens ?? 0,
  };
}

async function chatOllama(config: LLMConfig, messages: LLMMessage[]): Promise<LLMResponse> {
  const url = `${config.baseUrl}/api/chat`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages,
      stream: false,
      options: { temperature: config.temperature, num_predict: config.maxTokens },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    throw new Error(`Ollama returned ${resp.status}`);
  }

  const data = await resp.json() as {
    message: { content: string };
    model?: string;
    prompt_eval_count?: number;
    eval_count?: number;
  };

  return {
    content: data.message?.content ?? '',
    model: data.model ?? config.model,
    provider: 'ollama',
    promptTokens: data.prompt_eval_count ?? 0,
    completionTokens: data.eval_count ?? 0,
  };
}

async function chatWithProvider(config: LLMConfig, messages: LLMMessage[], apiKey?: string): Promise<LLMResponse> {
  switch (config.provider) {
    case 'lmstudio':
      return chatOpenAICompatible(config, messages);
    case 'copilot': {
      const token = await getGitHubToken();
      return chatOpenAICompatible(config, messages, token);
    }
    case 'ollama':
      return chatOllama(config, messages);
    case 'hosted': {
      const key = apiKey ?? config.apiKey;
      if (!key) throw new Error('No API key for hosted tier. Run: spidersan ai-setup');
      return chatOpenAICompatible(config, messages, key);
    }
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

// Local-first fallback: never send repo context to remote without opt-in
const LOCAL_FALLBACK: LLMProvider[] = ['lmstudio', 'ollama'];
const REMOTE_PROVIDERS: LLMProvider[] = ['hosted', 'copilot'];

/** Resolve the hosted API key from env var or persisted config. */
async function resolveHostedApiKey(): Promise<string | undefined> {
  const envKey = process.env['SPIDERSAN_API_KEY'];
  if (envKey) return envKey;
  const config = await loadAiConfig();
  return config?.apiKey ?? undefined;
}

/**
 * Send a chat completion request with automatic fallback.
 *
 * Priority order (auto-routing when no explicit provider set):
 *   1. lmstudio (local)
 *   2. ollama (local)
 *   3. hosted (api.spidersan.dev) — only if API key available
 *   4. copilot — only if allowRemoteFallback or explicitly configured
 */
export async function chat(
  messages: LLMMessage[],
  configOverrides?: Partial<LLMConfig> & { allowRemoteFallback?: boolean },
): Promise<LLMResponse> {
  const { allowRemoteFallback, ...llmOverrides } = configOverrides ?? {};
  const config = resolveConfig(llmOverrides);
  const isRemote = REMOTE_PROVIDERS.includes(config.provider);
  const errors: Array<{ provider: LLMProvider; error: string }> = [];

  // Resolve hosted API key once (avoid repeated config reads in fallback loop)
  const hostedApiKey = await resolveHostedApiKey();

  // Try configured provider first
  try {
    return await chatWithProvider(config, messages, config.provider === 'hosted' ? hostedApiKey : undefined);
  } catch (err) {
    errors.push({ provider: config.provider, error: (err as Error).message });
  }

  // Local fallback chain
  for (const fallback of LOCAL_FALLBACK) {
    if (fallback === config.provider) continue;
    try {
      const result = await chatWithProvider(DEFAULT_LLM_CONFIGS[fallback], messages);
      result.provider = fallback;
      return result;
    } catch (err) {
      errors.push({ provider: fallback, error: (err as Error).message });
    }
  }

  // Remote fallback: hosted (if key available), then copilot (if opted in)
  if (allowRemoteFallback || isRemote) {
    // hosted — only if we have a key
    if (config.provider !== 'hosted' && hostedApiKey) {
      try {
        const result = await chatWithProvider(DEFAULT_LLM_CONFIGS.hosted, messages, hostedApiKey);
        result.provider = 'hosted';
        return result;
      } catch (err) {
        errors.push({ provider: 'hosted', error: (err as Error).message });
      }
    }

    // copilot
    for (const fallback of ['copilot'] as LLMProvider[]) {
      if (fallback === config.provider) continue;
      try {
        const result = await chatWithProvider(DEFAULT_LLM_CONFIGS[fallback], messages);
        result.provider = fallback;
        return result;
      } catch (err) {
        errors.push({ provider: fallback, error: (err as Error).message });
      }
    }
  }

  const summary = errors.map(e => `  ${e.provider}: ${e.error}`).join('\n');
  throw new Error(`All LLM providers failed:\n${summary}`);
}

/**
 * Quick health check — can we reach the configured provider?
 */
export async function ping(configOverrides?: Partial<LLMConfig>): Promise<{
  ok: boolean;
  provider: LLMProvider;
  model: string;
  latencyMs: number;
  error?: string;
}> {
  const config = resolveConfig(configOverrides);
  const start = Date.now();

  try {
    const result = await chat(
      [{ role: 'user', content: 'Reply with just "ok".' }],
      { ...config, maxTokens: 10 },
    );
    return {
      ok: true,
      provider: result.provider,
      model: result.model,
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ok: false,
      provider: config.provider,
      model: config.model,
      latencyMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}
