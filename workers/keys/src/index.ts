/**
 * spidersan Keys Worker — spidersan.net/keys
 *
 * GET  /keys          → HTML landing page with email form
 * POST /keys          → generate + store API key, render success inline (key never in URL)
 * GET  /keys?key=<k>  → HTML success page (legacy / direct link — validated + escaped)
 *
 * Writes to VALID_API_KEYS KV (same namespace as api-proxy).
 * Key format: spk_free_<40-char hex>  (20 CSPRNG bytes)
 * KV record:  { tier: "free", created: ISO, email_hash: SHA256(email).slice(0,12), label? }
 *
 * Security controls:
 *  B2 — per-IP key issuance rate limit (5/day, KV-based)
 *  B2 — Cloudflare Turnstile CAPTCHA on form, verified server-side, FAIL-CLOSED
 *       (no TURNSTILE_SECRET_KEY → issuance returns 503, never opens)
 *  B3 — GET ?key= validated against key regex + HTML-escaped before render
 *  M4 — POST renders success page inline; key never in redirect URL
 *  Hardening — every HTML response carries CSP + nosniff + X-Frame-Options:DENY
 *
 * Admin routes (require Authorization: Bearer <ADMIN_SECRET>):
 *  POST /keys/revoke  → mark a key revoked in KV (api-proxy rejects it on next use)
 *       + Referrer-Policy:no-referrer (see htmlHeaders)
 */

import { KEY_REGEX, IP_KEY_DAILY_LIMIT, FREE_KEY_TTL_DAYS, FREE_KEY_TTL_SECONDS } from '../../lib/constants';
import { checkDailyLimit } from '../../lib/rate-limit';
import type { ApiKeyRecord } from '../../lib/types';

export interface Env {
  VALID_API_KEYS: KVNamespace;
  /** CF Turnstile secret key — set via: wrangler secret put TURNSTILE_SECRET_KEY
   *  Create widget at: dash.cloudflare.com → Turnstile → Add site
   *  REQUIRED in production: if unset, POST /keys fails closed (503) — issuance
   *  will not open without a verifiable bot check. */
  TURNSTILE_SECRET_KEY?: string;
  /** CF Turnstile site key — public, safe in source.
   *  Set via wrangler.toml [vars] once you create the Turnstile widget. */
  TURNSTILE_SITE_KEY?: string;
  /** Admin secret for POST /keys/revoke. Set via: wrangler secret put ADMIN_SECRET
   *  If unset, POST /keys/revoke returns 503 (fail-closed — same pattern as Turnstile). */
  ADMIN_SECRET?: string;
}

const HTML_CONTENT_TYPE = 'text/html;charset=UTF-8';
// CSP: allows inline styles/scripts (copy button + CSS) and the CF Turnstile
// frame/script. connect-src is required too — the widget makes its own XHR /
// telemetry calls to challenges.cloudflare.com that default-src 'none' would
// otherwise block, silently failing the challenge.
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://challenges.cloudflare.com; style-src 'unsafe-inline'; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; form-action 'self'; base-uri 'none'";

function htmlHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': HTML_CONTENT_TYPE,
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff', // block MIME-sniffing (defense-in-depth behind the CSP)
    'X-Frame-Options': 'DENY', // this page renders a bearer key — never frame it (clickjacking)
    'Referrer-Policy': 'no-referrer', // don't leak the key page in a Referer header
    ...extra,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateKey(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `spk_free_${hex}`;
}

async function hashEmail(email: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase().trim()));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}


/** B2: Cloudflare Turnstile server-side verification. */
async function verifyTurnstile(secretKey: string, token: string, ip: string): Promise<boolean> {
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: secretKey, response: token, remoteip: ip }),
    });
    if (!resp.ok) return false;
    const data = await resp.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

// ── HTML ─────────────────────────────────────────────────────────────────────

const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0d0d0d;
    --surface: #141414;
    --border: #262626;
    --text: #e8e8e8;
    --muted: #666;
    --accent: #7c6aff;
    --accent-dim: #3d3566;
    --green: #3ecf8e;
    --red: #f87171;
    --mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .card {
    width: 100%;
    max-width: 480px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 2.5rem 2rem;
  }
  .logo {
    font-family: var(--mono);
    font-size: 1.1rem;
    color: var(--accent);
    letter-spacing: 0.04em;
    margin-bottom: 1.8rem;
  }
  .logo span { color: var(--muted); }
  h1 { font-size: 1.35rem; font-weight: 600; margin-bottom: 0.5rem; }
  .subtitle { color: var(--muted); font-size: 0.9rem; line-height: 1.6; margin-bottom: 2rem; }
  .limits {
    display: flex; gap: 1.5rem;
    margin-bottom: 2rem;
    padding: 1rem;
    background: #0a0a0a;
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 0.82rem;
  }
  .limit-item { display: flex; flex-direction: column; gap: 3px; }
  .limit-value { font-weight: 600; color: var(--green); font-size: 1rem; }
  .limit-label { color: var(--muted); }
  label { display: block; font-size: 0.85rem; color: var(--muted); margin-bottom: 0.4rem; }
  input[type="email"] {
    width: 100%; padding: 0.7rem 0.9rem;
    background: #0a0a0a; border: 1px solid var(--border);
    border-radius: 8px; color: var(--text);
    font-size: 0.95rem; outline: none;
    transition: border-color 0.15s;
  }
  input[type="email"]:focus { border-color: var(--accent); }
  .turnstile-wrap { margin-top: 1rem; }
  button[type="submit"] {
    width: 100%; margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: var(--accent); border: none; border-radius: 8px;
    color: #fff; font-size: 0.95rem; font-weight: 600;
    cursor: pointer; transition: opacity 0.15s;
  }
  button[type="submit"]:hover { opacity: 0.88; }
  .notice {
    margin-top: 1.5rem; font-size: 0.78rem; color: var(--muted);
    line-height: 1.6; padding-top: 1rem;
    border-top: 1px solid var(--border);
  }
  .notice a { color: var(--accent); text-decoration: none; }

  /* success */
  .key-box {
    display: flex; align-items: center; gap: 0.5rem;
    background: #0a0a0a; border: 1px solid var(--border);
    border-radius: 8px; padding: 0.9rem 1rem;
    margin: 1.5rem 0;
  }
  .key-value {
    flex: 1; font-family: var(--mono); font-size: 0.82rem;
    color: var(--green); word-break: break-all;
    user-select: all;
  }
  .copy-btn {
    flex-shrink: 0; padding: 0.35rem 0.7rem;
    background: var(--accent-dim); border: 1px solid var(--accent);
    border-radius: 6px; color: var(--accent);
    font-size: 0.78rem; cursor: pointer;
    font-family: inherit; transition: background 0.15s;
  }
  .copy-btn:hover { background: var(--accent); color: #fff; }
  .steps {
    font-size: 0.85rem; line-height: 1.7; color: var(--muted);
    margin-bottom: 1.5rem;
  }
  .steps strong { display: block; color: var(--text); margin-top: 1.3rem; }
  .steps strong:first-child { margin-top: 0; }
  .steps .hint { font-size: 0.78rem; color: var(--muted); margin-top: 0.45rem; }
  .cmd {
    display: block; margin-top: 0.5rem;
    font-family: var(--mono); font-size: 0.8rem; line-height: 1.55;
    background: #0a0a0a; border: 1px solid var(--border);
    border-radius: 8px; padding: 0.7rem 0.9rem;
    color: var(--text);
    white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere;
  }
  .badge-free {
    display: inline-block; font-size: 0.72rem; font-weight: 600;
    background: var(--accent-dim); color: var(--accent);
    border: 1px solid var(--accent); border-radius: 4px;
    padding: 0.1rem 0.4rem; margin-left: 0.4rem;
    vertical-align: middle;
  }
  .error-msg { color: var(--red); font-size: 0.85rem; margin-top: 0.6rem; }
`;

function renderLandingPage(siteKey?: string, error?: string): string {
  const turnstileScript = siteKey
    ? `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : '';
  const turnstileWidget = siteKey
    ? `<div class="turnstile-wrap"><div class="cf-turnstile" data-sitekey="${escapeHtml(siteKey)}" data-theme="dark"></div></div>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get a free API key — spidersan</title>
<style>${CSS}</style>
${turnstileScript}
</head>
<body>
<div class="card">
  <div class="logo">spidersan<span>.net</span></div>
  <h1>Get your free API key</h1>
  <p class="subtitle">Semantic conflict detection for multi-branch git workflows — the class of bug that passes <code style="font-family:monospace;font-size:0.85em;color:#7c6aff">git merge</code> cleanly but breaks at runtime.</p>
  <div class="limits">
    <div class="limit-item">
      <span class="limit-value">50</span>
      <span class="limit-label">requests / day</span>
    </div>
    <div class="limit-item">
      <span class="limit-value">free</span>
      <span class="limit-label">no credit card</span>
    </div>
    <div class="limit-item">
      <span class="limit-value">spidersan-v1</span>
      <span class="limit-label">fine-tuned</span>
    </div>
  </div>
  <form method="POST" action="/keys">
    <label for="email">Your email</label>
    <input type="email" id="email" name="email" placeholder="you@example.com" required autocomplete="email">
    ${error ? `<p class="error-msg">${escapeHtml(error)}</p>` : ''}
    ${turnstileWidget}
    <button type="submit">Generate free key →</button>
  </form>
  <p class="notice">
    Your email is hashed before storage — we don't keep the plaintext.
    By generating a key you agree not to use this API for bulk data extraction or model distillation.
    Contributor tier (unlimited requests) available via session contribution.
  </p>
</div>
</body>
</html>`;
}

/** B3: key is validated against KEY_REGEX before reaching this function, and escaped here as defence-in-depth. */
function renderSuccessPage(key: string): string {
  const safeKey = escapeHtml(key);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your API key — spidersan</title>
<style>${CSS}</style>
</head>
<body>
<div class="card">
  <div class="logo">spidersan<span>.net</span></div>
  <h1>Your API key <span class="badge-free">FREE</span></h1>

  <div class="key-box">
    <span class="key-value" id="key-value">${safeKey}</span>
    <button class="copy-btn" onclick="copyKey()">copy</button>
  </div>

  <div class="steps">
    <strong>Add to spidersan CLI:</strong>
    <div class="cmd">spidersan ai-setup --tier free</div>
    <p class="hint">…then paste your key when prompted.</p>

    <strong>Or set the env var:</strong>
    <div class="cmd">export SPIDERSAN_API_KEY=${safeKey}</div>

    <strong>Or call the API directly:</strong>
    <div class="cmd">curl https://api.spidersan.net/v1/chat/completions \\
  -H "Authorization: Bearer ${safeKey}" \\
  -d '{"model":"spidersan-v1","messages":[...]}'</div>
  </div>

  <p class="notice">
    Save this key — it won't be shown again. Free tier: 50 requests/day, resets at UTC midnight.
    Keys expire ${FREE_KEY_TTL_DAYS} days after issue. Lost or expired key? <a href="/keys">Generate a new one</a>.
  </p>
</div>
<script>
function copyKey() {
  const key = document.getElementById('key-value').textContent;
  navigator.clipboard.writeText(key).then(() => {
    const btn = document.querySelector('.copy-btn');
    btn.textContent = 'copied!';
    btn.style.background = 'var(--green)';
    btn.style.color = '#0d0d0d';
    btn.style.borderColor = 'var(--green)';
    setTimeout(() => {
      btn.textContent = 'copy';
      btn.style.background = '';
      btn.style.color = '';
      btn.style.borderColor = '';
    }, 2000);
  });
}
</script>
</body>
</html>`;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Constant-time string comparison — guards POST /keys/revoke against timing oracles. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

async function handleRevoke(request: Request, env: Env): Promise<Response> {
  // Fail-closed: if ADMIN_SECRET is not configured, revocation is unavailable.
  if (!env.ADMIN_SECRET) {
    return jsonResponse(503, { error: 'Revocation not configured' });
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!timingSafeEqual(token, env.ADMIN_SECRET)) {
    return jsonResponse(401, { error: 'Unauthorized' });
  }

  let body: { key?: unknown; reason?: unknown };
  try {
    body = await request.json() as { key?: unknown; reason?: unknown };
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const key = typeof body.key === 'string' ? body.key : '';
  const reason = typeof body.reason === 'string' ? body.reason : undefined;

  if (!KEY_REGEX.test(key)) {
    return jsonResponse(400, { error: 'Missing or invalid key' });
  }

  const raw = await env.VALID_API_KEYS.get(key, { type: 'text' });
  if (!raw) {
    return jsonResponse(404, { error: 'Key not found' });
  }

  let record: ApiKeyRecord;
  try {
    record = JSON.parse(raw) as ApiKeyRecord;
  } catch {
    return jsonResponse(500, { error: 'Key record corrupt' });
  }

  // Idempotent: re-revoking an already-revoked key is a no-op success.
  if (record.revoked) {
    return jsonResponse(200, { ok: true, already_revoked: true });
  }

  // KV put resets the TTL unless we re-specify it. Re-derive remaining seconds
  // from expires_at so the record keeps its original expiry window.
  let expirationTtl: number | undefined;
  if (record.expires_at) {
    const remaining = Math.floor((Date.parse(record.expires_at) - Date.now()) / 1000);
    if (remaining <= 0) {
      // Already expired — the api-proxy would have lazy-deleted it; treat as gone.
      return jsonResponse(404, { error: 'Key not found' });
    }
    expirationTtl = remaining;
  }

  const updated: ApiKeyRecord = {
    ...record,
    revoked: true,
    revoked_at: new Date().toISOString(),
    ...(reason !== undefined ? { revoked_reason: reason } : {}),
  };

  await env.VALID_API_KEYS.put(key, JSON.stringify(updated), expirationTtl ? { expirationTtl } : undefined);
  return jsonResponse(200, { ok: true });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/keys/revoke' && request.method === 'POST') {
      return handleRevoke(request, env);
    }

    if (url.pathname !== '/keys' && url.pathname !== '/keys/') {
      return new Response('Not found', { status: 404 });
    }

    // GET /keys?key=<value> → success page (legacy / direct link)
    // B3: validate key format strictly before rendering — rejects any non-key value
    const keyParam = url.searchParams.get('key');
    if (request.method === 'GET' && keyParam !== null) {
      if (!KEY_REGEX.test(keyParam)) {
        return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Invalid or missing key.'), {
          status: 400,
          headers: htmlHeaders(),
        });
      }
      return new Response(renderSuccessPage(keyParam), {
        headers: htmlHeaders(),
      });
    }

    // GET /keys → landing page
    if (request.method === 'GET') {
      return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY), {
        headers: htmlHeaders(),
      });
    }

    // POST /keys → issue key
    if (request.method === 'POST') {
      let email = '';
      let turnstileToken = '';
      try {
        const body = await request.formData();
        email = (body.get('email') as string | null) ?? '';
        turnstileToken = (body.get('cf-turnstile-response') as string | null) ?? '';
      } catch {
        return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Invalid form submission.'), {
          status: 400,
          headers: htmlHeaders(),
        });
      }

      if (!isValidEmail(email)) {
        return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Please enter a valid email address.'), {
          status: 400,
          headers: htmlHeaders(),
        });
      }

      const ip = request.headers.get('CF-Connecting-IP') ?? '';

      // B2: Cloudflare Turnstile verification — fail-closed.
      // If the secret is unset we do NOT issue a key (previously fail-open: the
      // check was skipped when TURNSTILE_SECRET_KEY was absent). Production sets
      // the secret, so no behaviour change there — this only hardens the
      // unconfigured / misdeploy case so a bad deploy can't silently open issuance.
      if (!env.TURNSTILE_SECRET_KEY) {
        return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Key issuance is temporarily unavailable.'), {
          status: 503,
          headers: htmlHeaders(),
        });
      }
      const turnstileOk = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
      if (!turnstileOk) {
        return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Bot check failed — please try again.'), {
          status: 403,
          headers: htmlHeaders(),
        });
      }

      // B2: per-IP issuance rate limit (always enforced, regardless of Turnstile).
      // If IP is absent, allow — Turnstile is the other gate.
      if (ip) {
        const { allowed } = await checkDailyLimit(env.VALID_API_KEYS, 'ip_rl', ip, IP_KEY_DAILY_LIMIT);
        if (!allowed) {
          return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Too many keys generated from this IP today. Try again tomorrow.'), {
            status: 429,
            headers: htmlHeaders(),
          });
        }
      }

      const key = generateKey();
      const emailHash = await hashEmail(email);

      const now = Date.now();
      const record: ApiKeyRecord = {
        tier: 'free',
        created: new Date(now).toISOString(),
        email_hash: emailHash,
        expires_at: new Date(now + FREE_KEY_TTL_SECONDS * 1000).toISOString(),
      };

      // M2: expirationTtl auto-deletes the record at expiry; the api-proxy still
      // lazy-checks expires_at so behaviour is deterministic regardless of KV GC timing.
      await env.VALID_API_KEYS.put(key, JSON.stringify(record), { expirationTtl: FREE_KEY_TTL_SECONDS });

      // M4: render success inline — key stays out of the URL and CF access logs
      return new Response(renderSuccessPage(key), {
        status: 200,
        headers: htmlHeaders(),
      });
    }

    return new Response('Method not allowed', { status: 405 });
  },
};
