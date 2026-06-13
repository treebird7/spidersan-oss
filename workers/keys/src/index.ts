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
 *       + Referrer-Policy:no-referrer (see htmlHeaders)
 */

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
}

interface KeyRecord {
  tier: 'free' | 'contributor';
  created: string;
  email_hash: string;
  label?: string;
  /** M2: ISO expiry. Absent = never expires. validateApiKey lazy-expires on read. */
  expires_at?: string;
  /** M2: per-key disable flag. Set true to revoke without deleting (keeps audit record). */
  revoked?: boolean;
  revoked_at?: string;
  revoked_reason?: string;
}

const KEY_REGEX = /^spk_(free|contributor)_[0-9a-f]{40}$/;
const IP_KEY_DAILY_LIMIT = 5; // max new keys per IP per day
// M2: free keys expire after this window — bounds the accumulation of permanent
// credentials. Written as expires_at in the record AND as the KV expirationTtl so
// storage auto-cleans; api-proxy lazy-checks expires_at as the authoritative gate.
const FREE_KEY_TTL_DAYS = 90;
const FREE_KEY_TTL_SECONDS = FREE_KEY_TTL_DAYS * 24 * 60 * 60;
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

/** B2: per-IP issuance rate limit. Not atomic but sufficient as a friction layer. */
async function checkIpKeyLimit(env: Env, ip: string): Promise<boolean> {
  if (!ip) return true; // can't identify IP — allow (Turnstile is the other gate)
  const today = new Date().toISOString().slice(0, 10);
  // Counters share the credential KV namespace, distinguished only by the
  // `ip_rl:` prefix (vs `spk_` for keys). Safe — all reads are exact-match
  // lookups, never list/scan — but a future KV dump would conflate the two.
  // If counters grow, split into a dedicated namespace.
  const kvKey = `ip_rl:${ip}:${today}`;
  const raw = await env.VALID_API_KEYS.get(kvKey, { type: 'text' });
  const count = raw ? parseInt(raw, 10) : 0;
  if (count >= IP_KEY_DAILY_LIMIT) return false;
  env.VALID_API_KEYS.put(kvKey, String(count + 1), { expirationTtl: 172800 }).catch(() => {});
  return true;
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

// ── Handler ───────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

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

      // B2: per-IP issuance rate limit (always enforced, regardless of Turnstile)
      const ipAllowed = await checkIpKeyLimit(env, ip);
      if (!ipAllowed) {
        return new Response(renderLandingPage(env.TURNSTILE_SITE_KEY, 'Too many keys generated from this IP today. Try again tomorrow.'), {
          status: 429,
          headers: htmlHeaders(),
        });
      }

      const key = generateKey();
      const emailHash = await hashEmail(email);

      const now = Date.now();
      const record: KeyRecord = {
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
