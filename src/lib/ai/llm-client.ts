/**
 * Spidersan AI Core — LLM Client
 *
 * Unified interface for LLM providers with automatic fallback chain:
 * LM Studio (Gemma 4) → GitHub Copilot (gpt-4o) → Ollama (offline)
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LLMConfig, LLMMessage, LLMProvider, LLMResponse } from './types.js';
import { DEFAULT_LLM_CONFIGS } from './types.js';

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

async function chatWithProvider(config: LLMConfig, messages: LLMMessage[]): Promise<LLMResponse> {
  switch (config.provider) {
    case 'lmstudio':
      return chatOpenAICompatible(config, messages);
    case 'copilot': {
      const token = await getGitHubToken();
      return chatOpenAICompatible(config, messages, token);
    }
    case 'ollama':
      return chatOllama(config, messages);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}

// Local-first fallback: never send repo context to remote without opt-in
const LOCAL_FALLBACK: LLMProvider[] = ['lmstudio', 'ollama'];
const REMOTE_PROVIDERS: LLMProvider[] = ['copilot'];

/**
 * Send a chat completion request with automatic fallback.
 * Tries local providers first (lmstudio → ollama).
 * Remote providers (copilot) only used if explicitly configured or opt-in.
 */
export async function chat(
  messages: LLMMessage[],
  configOverrides?: Partial<LLMConfig> & { allowRemoteFallback?: boolean },
): Promise<LLMResponse> {
  const { allowRemoteFallback, ...llmOverrides } = configOverrides ?? {};
  const config = resolveConfig(llmOverrides);
  const isRemote = REMOTE_PROVIDERS.includes(config.provider);
  const errors: Array<{ provider: LLMProvider; error: string }> = [];

  // Try configured provider first
  try {
    return await chatWithProvider(config, messages);
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

  // Remote fallback only if explicitly opted in or user configured a remote provider
  if (allowRemoteFallback || isRemote) {
    for (const fallback of REMOTE_PROVIDERS) {
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
