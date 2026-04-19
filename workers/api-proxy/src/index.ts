/**
 * spidersan API Proxy — Cloudflare Worker
 *
 * Proxies /v1/chat/completions and /v1/models to the fine-tuned model backend.
 * Auth: Bearer token validated against VALID_API_KEYS KV namespace.
 *
 * Deploy to: api.spidersan.dev
 *
 * KV bindings required (wrangler.toml):
 *   VALID_API_KEYS  — key = raw API key string, value = metadata JSON
 *                     e.g. '{"tier":"free","created":"2026-01-01T00:00:00Z"}'
 *
 * Environment variables:
 *   MODEL_BACKEND_URL — base URL of the model backend (no trailing slash)
 *                       e.g. https://model.internal.spidersan.dev
 *
 * Rate limiting: tracked per-key in KV (eventually consistent — use Durable Objects
 * for exact enforcement, this is advisory only).
 *
 * TODO(P3-4): Migrate to Durable Object rate limiter for precise per-key limits.
 */

export interface Env {
  VALID_API_KEYS: KVNamespace;
  MODEL_BACKEND_URL: string;
}

const ALLOWED_PATHS = new Set(['/v1/chat/completions', '/v1/models']);
const RATE_LIMIT_PER_HOUR = 100;

interface KeyMetadata {
  tier: 'free' | 'contributor';
  created: string;
  label?: string;
}

async function validateApiKey(env: Env, key: string): Promise<KeyMetadata | null> {
  const raw = await env.VALID_API_KEYS.get(key, { type: 'text' });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as KeyMetadata;
  } catch {
    // Legacy key with no metadata — treat as free tier
    return { tier: 'free', created: '' };
  }
}

/** Advisory per-key hourly counter in KV. Not atomic — use for telemetry, not enforcement. */
async function checkRateLimit(env: Env, key: string): Promise<{ remaining: number; limited: boolean }> {
  const bucketKey = `rl:${key}:${new Date().toISOString().slice(0, 13)}`; // hourly bucket
  const raw = await env.VALID_API_KEYS.get(bucketKey, { type: 'text' });
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= RATE_LIMIT_PER_HOUR) {
    return { remaining: 0, limited: true };
  }
  // Fire-and-forget update (eventually consistent)
  env.VALID_API_KEYS.put(bucketKey, String(count + 1), { expirationTtl: 7200 }).catch(() => {});
  return { remaining: RATE_LIMIT_PER_HOUR - count - 1, limited: false };
}

function errorResponse(status: number, message: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { message, type: 'api_error', code: status } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Only allow supported paths
    if (!ALLOWED_PATHS.has(path)) {
      return errorResponse(404, `Not found: ${path}`);
    }

    // Only allow GET /v1/models and POST /v1/chat/completions
    if (path === '/v1/chat/completions' && request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed');
    }
    if (path === '/v1/models' && request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed');
    }

    // Validate Bearer token
    const authHeader = request.headers.get('Authorization') ?? '';
    const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!apiKey) {
      return errorResponse(401, 'Missing API key. Include Authorization: Bearer <key>');
    }

    const keyMeta = await validateApiKey(env, apiKey);
    if (!keyMeta) {
      return errorResponse(401, 'Invalid API key');
    }

    // Rate limiting (advisory, KV-based)
    const { remaining, limited } = await checkRateLimit(env, apiKey);
    if (limited) {
      return errorResponse(429, 'Rate limit exceeded (100 req/hr). Upgrade to contributor for unlimited.', {
        'X-RateLimit-Limit': String(RATE_LIMIT_PER_HOUR),
        'X-RateLimit-Remaining': '0',
        'Retry-After': '3600',
      });
    }

    // Proxy to backend — strip client auth, add backend forwarding headers
    const backendUrl = `${env.MODEL_BACKEND_URL}${path}${url.search}`;
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('Authorization');
    proxyHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? 'unknown');
    proxyHeaders.set('X-Spidersan-Tier', keyMeta.tier);

    const proxyRequest = new Request(backendUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' ? request.body : null,
    });

    try {
      const backendResp = await fetch(proxyRequest);
      const respHeaders = new Headers(backendResp.headers);
      respHeaders.set('X-RateLimit-Limit', String(RATE_LIMIT_PER_HOUR));
      respHeaders.set('X-RateLimit-Remaining', String(remaining));

      return new Response(backendResp.body, {
        status: backendResp.status,
        headers: respHeaders,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return errorResponse(502, `Backend unavailable: ${msg}`);
    }
  },
};
