/**
 * spidersan API Proxy — Cloudflare Worker
 *
 * Proxies /v1/chat/completions and /v1/models to the fine-tuned model backend.
 * Auth: Bearer token validated against VALID_API_KEYS KV namespace.
 *
 * Deploy to: api.spidersan.net
 *
 * KV bindings required (wrangler.toml):
 *   VALID_API_KEYS  — key = raw API key string, value = metadata JSON
 *                     e.g. '{"tier":"free","created":"2026-01-01T00:00:00Z"}'
 *
 * Secrets (set via wrangler secret put):
 *   MODEL_BACKEND_URL      — base URL of the model backend (no trailing slash)
 *                            e.g. https://spidersan-model.treebird.uk
 *   MODEL_ID               — model ID the backend expects; rewritten into requests
 *                            e.g. sweep-m5-b4v2c4c3m2c5-a095/fused
 *   CF_ACCESS_CLIENT_ID    — CF Access service token ID (gates the model tunnel; B1)
 *   CF_ACCESS_CLIENT_SECRET — CF Access service token secret (B1)
 *
 * Rate limiting: per-key KV counter (eventually consistent — advisory only).
 * TODO(P3): Migrate to Durable Object rate limiter for precise enforcement.
 */

import { FREE_TIER_DAILY_LIMIT, MAX_OUTPUT_TOKENS, MAX_REQUEST_BYTES } from '../../lib/constants';
import { checkDailyLimit } from '../../lib/rate-limit';
import type { ApiKeyRecord } from '../../lib/types';

export interface Env {
  VALID_API_KEYS: KVNamespace;
  MODEL_BACKEND_URL: string;
  /** M1: required — Worker returns 503 if unset rather than passing model choice to client. */
  MODEL_ID: string;
  /** B1: CF Access service token — sent as CF-Access-Client-Id/Secret to gate the tunnel.
   *  Create at: dash.cloudflare.com → Access → Service Auth → Create Service Token
   *  Then protect the tunnel app with a policy requiring that token. */
  CF_ACCESS_CLIENT_ID?: string;
  CF_ACCESS_CLIENT_SECRET?: string;
}

const ALLOWED_PATHS = new Set(['/v1/chat/completions', '/v1/models']);

async function validateApiKey(env: Env, key: string): Promise<ApiKeyRecord | null> {
  const raw = await env.VALID_API_KEYS.get(key, { type: 'text' });
  if (!raw) return null;
  let meta: ApiKeyRecord;
  try {
    meta = JSON.parse(raw) as ApiKeyRecord;
  } catch {
    return null; // M2: a corrupt record is not a valid credential
  }
  // M2: revocation — disabled keys rejected (record kept for audit). Generic 401
  // upstream, so this doesn't leak revoked-vs-nonexistent to the caller.
  if (meta.revoked) return null;
  // M2: lazy expiry on read — reject expired keys, best-effort delete the stale record.
  // A malformed expires_at (Date.parse → NaN) must fail CLOSED: NaN <= now is false,
  // so without the isFinite guard a corrupt/truncated record becomes a permanent key.
  if (meta.expires_at) {
    const exp = Date.parse(meta.expires_at);
    if (!Number.isFinite(exp) || exp <= Date.now()) {
      env.VALID_API_KEYS.delete(key).catch(() => {});
      return null;
    }
  }
  return meta;
}


function errorResponse(status: number, message: string, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify({ error: { message, type: 'api_error', code: status } }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** M2: normalize /v1/models response — strips internal FS model paths from clients. */
function normalizedModelsResponse(): Response {
  return new Response(
    JSON.stringify({
      object: 'list',
      data: [{ id: 'spidersan-v1', object: 'model', owned_by: 'spidersan', created: 0 }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/**
 * M3 (leak): allowlist response headers. The backend (mlx_lm.server / uvicorn)
 * emits Server / Date / version headers that fingerprint the serving machine's
 * stack — never forward them. Only Content-Type, an optional Cache-Control, and
 * our own rate-limit headers reach the client.
 */
function safeResponseHeaders(backendResp: Response, tier: string, remaining: number): Headers {
  const h = new Headers();
  h.set('Content-Type', backendResp.headers.get('Content-Type') ?? 'application/json');
  const cacheControl = backendResp.headers.get('Cache-Control');
  if (cacheControl) h.set('Cache-Control', cacheControl);
  if (tier === 'free') {
    h.set('X-RateLimit-Limit', String(FREE_TIER_DAILY_LIMIT));
    h.set('X-RateLimit-Remaining', String(remaining));
  }
  return h;
}

/**
 * M3 (leak): replace every occurrence of the internal model id with the public
 * alias across a streamed byte body, holding back (id.length - 1) chars so an id
 * split across a chunk boundary can't slip through unreplaced. Used for the SSE
 * streaming path; the non-streaming path rewrites the parsed `model` field directly.
 */
function scrubModelIdStream(modelId: string, alias: string): TransformStream<Uint8Array, Uint8Array> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const hold = Math.max(0, modelId.length - 1);
  let carry = '';
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = (carry + dec.decode(chunk, { stream: true })).split(modelId).join(alias);
      const cut = Math.max(0, text.length - hold);
      carry = text.slice(cut);
      if (cut > 0) controller.enqueue(enc.encode(text.slice(0, cut)));
    },
    flush(controller) {
      const tail = carry.split(modelId).join(alias);
      if (tail) controller.enqueue(enc.encode(tail));
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '') || '/';

    if (!ALLOWED_PATHS.has(path)) {
      return errorResponse(404, `Not found: ${path}`);
    }

    if (path === '/v1/chat/completions' && request.method !== 'POST') {
      return errorResponse(405, 'Method not allowed');
    }
    if (path === '/v1/models' && request.method !== 'GET') {
      return errorResponse(405, 'Method not allowed');
    }

    // C1 (cost): reject oversized requests up front, before any KV/backend work.
    // Covers the declared-length case; chunked uploads are re-checked post-parse.
    const declaredLen = Number(request.headers.get('Content-Length') ?? '0');
    if (Number.isFinite(declaredLen) && declaredLen > MAX_REQUEST_BYTES) {
      return errorResponse(413, `Request too large (max ${MAX_REQUEST_BYTES} bytes)`);
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

    // M1: fail-closed — reject if MODEL_ID secret was never set
    if (!env.MODEL_ID) {
      return errorResponse(503, 'Model backend not configured');
    }

    // Rate limiting — contributor tier is unlimited; free tier gets a daily counter.
    let remaining = -1;
    if (keyMeta.tier === 'free') {
      const { allowed, remaining: rem, resetAt } = await checkDailyLimit(
        env.VALID_API_KEYS, 'rl', apiKey, FREE_TIER_DAILY_LIMIT,
      );
      if (!allowed) {
        return errorResponse(429, `Daily limit reached (${FREE_TIER_DAILY_LIMIT} req/day). Upgrade to contributor tier for unlimited.`, {
          'X-RateLimit-Limit': String(FREE_TIER_DAILY_LIMIT),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': new Date(resetAt).toUTCString(),
          'Retry-After': String(Math.floor((resetAt - Date.now()) / 1000)),
        });
      }
      remaining = rem;
    }

    // M2: /v1/models — return normalized list (never proxy FS model paths to clients)
    if (path === '/v1/models') {
      return normalizedModelsResponse();
    }

    // Proxy to backend
    const backendUrl = `${env.MODEL_BACKEND_URL}${path}${url.search}`;
    const proxyHeaders = new Headers(request.headers);
    proxyHeaders.delete('Authorization');
    proxyHeaders.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? 'unknown');
    proxyHeaders.set('X-Spidersan-Tier', keyMeta.tier);

    // B1: CF Access service token — authenticates this Worker to the tunnel
    // Requires: CF Access app protecting spidersan-model.treebird.uk with a service token policy
    if (env.CF_ACCESS_CLIENT_ID) {
      proxyHeaders.set('CF-Access-Client-Id', env.CF_ACCESS_CLIENT_ID);
    }
    if (env.CF_ACCESS_CLIENT_SECRET) {
      proxyHeaders.set('CF-Access-Client-Secret', env.CF_ACCESS_CLIENT_SECRET);
    }

    // Rewrite model field — client sends "spidersan-v1", backend expects the actual model ID
    let proxyBody: BodyInit | null = request.body;
    if (path === '/v1/chat/completions' && request.method === 'POST') {
      try {
        const json = await request.json() as Record<string, unknown>;
        json['model'] = env.MODEL_ID;
        // C1 (cost): clamp output length to the ceiling; also sets a bounded
        // default when the client omits max_tokens (open-ended generation).
        const reqMax = typeof json['max_tokens'] === 'number' ? json['max_tokens'] as number : 0;
        json['max_tokens'] = reqMax > 0 ? Math.min(reqMax, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS;
        const serialized = JSON.stringify(json);
        // C1 (cost): re-check size for chunked uploads with no Content-Length.
        if (serialized.length > MAX_REQUEST_BYTES) {
          return errorResponse(413, `Request too large (max ${MAX_REQUEST_BYTES} bytes)`);
        }
        proxyBody = serialized;
        proxyHeaders.set('Content-Type', 'application/json');
      } catch {
        proxyBody = null;
      }
    }

    const proxyRequest = new Request(backendUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: proxyBody,
    });

    let backendResp: Response;
    try {
      backendResp = await fetch(proxyRequest);
    } catch {
      // M3 (leak): never surface the underlying fetch error — it can name the
      // backend host or network internals. Generic message only.
      return errorResponse(502, 'Backend unavailable');
    }

    // M3 (leak): the backend's own error bodies can carry local filesystem paths
    // and Python tracebacks. Never forward them — collapse to a generic message
    // with a coarse status class.
    if (!backendResp.ok) {
      const status = backendResp.status >= 500 ? 502 : 400;
      return errorResponse(status, status === 502 ? 'Backend error' : 'Backend rejected the request');
    }

    const respHeaders = safeResponseHeaders(backendResp, keyMeta.tier, remaining);
    const contentType = respHeaders.get('Content-Type') ?? '';

    // M3 (leak): the completion response echoes the request `model` field — i.e.
    // the internal MODEL_ID (an FS-style identifier). Rewrite it to the public
    // alias on the way out, symmetric with /v1/models (M2).
    if (contentType.includes('text/event-stream') && backendResp.body) {
      return new Response(
        backendResp.body.pipeThrough(scrubModelIdStream(env.MODEL_ID, 'spidersan-v1')),
        { status: 200, headers: respHeaders },
      );
    }

    // Non-streaming JSON: parse, rewrite `model`, re-serialize. If the body isn't
    // the shape we expect, fail closed rather than forward an unknown payload.
    try {
      const data = await backendResp.json() as Record<string, unknown>;
      if (typeof data['model'] === 'string') data['model'] = 'spidersan-v1';
      return new Response(JSON.stringify(data), { status: 200, headers: respHeaders });
    } catch {
      return errorResponse(502, 'Backend error');
    }
  },
};
