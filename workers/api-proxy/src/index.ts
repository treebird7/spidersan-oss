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
  /** Internal model ID the backend expects. Rewrites `model` field in chat/completions requests.
   *  Set via: wrangler secret put MODEL_ID
   *  e.g. /Users/freedbird/Dev/spidersan-ai/output/mlx-run-p2a3c-20260421-0114/fused-best-600 */
  MODEL_ID?: string;
}

const ALLOWED_PATHS = new Set(['/v1/chat/completions', '/v1/models']);
// Free tier: 50 req/day. Contributor: unlimited.
const FREE_TIER_DAILY_LIMIT = 50;

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

/**
 * Advisory per-key daily counter in KV for free tier. Not atomic — eventually consistent.
 * Contributor tier skips this entirely (unlimited).
 */
async function checkRateLimit(
  env: Env,
  key: string,
  tier: 'free' | 'contributor',
): Promise<{ remaining: number; limited: boolean }> {
  if (tier === 'contributor') {
    return { remaining: -1, limited: false }; // unlimited
  }
  const bucketKey = `rl:${key}:${new Date().toISOString().slice(0, 10)}`; // daily bucket YYYY-MM-DD
  const raw = await env.VALID_API_KEYS.get(bucketKey, { type: 'text' });
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= FREE_TIER_DAILY_LIMIT) {
    return { remaining: 0, limited: true };
  }
  // Fire-and-forget update (eventually consistent)
  env.VALID_API_KEYS.put(bucketKey, String(count + 1), { expirationTtl: 172800 }).catch(() => {}); // 48h TTL
  return { remaining: FREE_TIER_DAILY_LIMIT - count - 1, limited: false };
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

    // Rate limiting (advisory, KV-based; contributor = unlimited)
    const { remaining, limited } = await checkRateLimit(env, apiKey, keyMeta.tier);
    if (limited) {
      return errorResponse(429, 'Daily limit reached (50 req/day). Upgrade to contributor tier for unlimited.', {
        'X-RateLimit-Limit': String(FREE_TIER_DAILY_LIMIT),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(new Date().setUTCHours(24, 0, 0, 0)).toUTCString(),
        'Retry-After': String(Math.floor((new Date().setUTCHours(24, 0, 0, 0) - Date.now()) / 1000)),
      });
    }

    // Proxy to backend — strip client auth, add backend forwarding headers
    const backendUrl = `${env.MODEL_BACKEND_URL}${path}${url.search}`;
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('Authorization');
    proxyHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? 'unknown');
    proxyHeaders.set('X-Spidersan-Tier', keyMeta.tier);

    // Rewrite model field if MODEL_ID secret is set — client sends "spidersan-v1",
    // mlx_lm.server expects the actual model path or HF model ID.
    let proxyBody: BodyInit | null = request.method !== 'GET' ? request.body : null;
    if (env.MODEL_ID && path === '/v1/chat/completions' && request.method === 'POST') {
      try {
        const json = await request.json() as Record<string, unknown>;
        json['model'] = env.MODEL_ID;
        proxyBody = JSON.stringify(json);
        proxyHeaders.set('Content-Type', 'application/json');
      } catch {
        // Body unreadable — pass through as-is
        proxyBody = null;
      }
    }

    const proxyRequest = new Request(backendUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: proxyBody,
    });

    try {
      const backendResp = await fetch(proxyRequest);
      const respHeaders = new Headers(backendResp.headers);
      if (keyMeta.tier === 'free') {
        respHeaders.set('X-RateLimit-Limit', String(FREE_TIER_DAILY_LIMIT));
        respHeaders.set('X-RateLimit-Remaining', String(remaining));
      }

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
