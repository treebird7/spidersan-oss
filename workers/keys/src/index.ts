/**
 * spidersan Keys Worker — spidersan.dev/keys
 *
 * GET  /keys          → HTML landing page with email form
 * POST /keys          → generate + store API key, redirect to /keys?key=<key>
 * GET  /keys?key=<k>  → HTML success page showing the key
 *
 * Writes to VALID_API_KEYS KV (same namespace as api-proxy).
 * Key format: spk_free_<32-char hex>
 * KV record:  { tier: "free", created: ISO, email_hash: SHA256(email).slice(0,12), label? }
 */

export interface Env {
  VALID_API_KEYS: KVNamespace;
}

interface KeyRecord {
  tier: 'free' | 'contributor';
  created: string;
  email_hash: string;
  label?: string;
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
  .steps code {
    font-family: var(--mono); font-size: 0.8rem;
    background: #0a0a0a; border: 1px solid var(--border);
    padding: 0.15rem 0.4rem; border-radius: 4px;
    color: var(--text);
  }
  .steps strong { color: var(--text); }
  .badge-free {
    display: inline-block; font-size: 0.72rem; font-weight: 600;
    background: var(--accent-dim); color: var(--accent);
    border: 1px solid var(--accent); border-radius: 4px;
    padding: 0.1rem 0.4rem; margin-left: 0.4rem;
    vertical-align: middle;
  }
  .error-msg { color: var(--red); font-size: 0.85rem; margin-top: 0.6rem; }
`;

function renderLandingPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Get a free API key — spidersan</title>
<style>${CSS}</style>
</head>
<body>
<div class="card">
  <div class="logo">spidersan<span>.dev</span></div>
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
      <span class="limit-value">spidersan-llm</span>
      <span class="limit-label">fine-tuned</span>
    </div>
  </div>
  <form method="POST" action="/keys">
    <label for="email">Your email</label>
    <input type="email" id="email" name="email" placeholder="you@example.com" required autocomplete="email">
    ${error ? `<p class="error-msg">${error}</p>` : ''}
    <button type="submit">Generate free key →</button>
  </form>
  <p class="notice">
    Your email is hashed before storage — we don't keep the plaintext.
    By generating a key you agree not to use this API for bulk data extraction or model distillation.
    Contributor tier (unlimited requests) available via <a href="https://spidersan.dev/docs/contributor">session contribution</a>.
  </p>
</div>
</body>
</html>`;
}

function renderSuccessPage(key: string): string {
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
  <div class="logo">spidersan<span>.dev</span></div>
  <h1>Your API key <span class="badge-free">FREE</span></h1>

  <div class="key-box">
    <span class="key-value" id="key-value">${key}</span>
    <button class="copy-btn" onclick="copyKey()">copy</button>
  </div>

  <div class="steps">
    <strong>Add to spidersan CLI:</strong><br>
    Run <code>spidersan ai setup --tier free</code> and paste your key when prompted.<br><br>
    <strong>Or set the env var:</strong><br>
    <code>export SPIDERSAN_API_KEY=${key}</code><br><br>
    <strong>Or call the API directly:</strong><br>
    <code>curl https://spidersan-api-proxy.spidersan.workers.dev/v1/chat/completions \\<br>
&nbsp;&nbsp;-H "Authorization: Bearer ${key}" \\<br>
&nbsp;&nbsp;-d '{"model":"spidersan-v1","messages":[...]}'</code>
  </div>

  <p class="notice">
    Save this key — it won't be shown again. Free tier: 50 requests/day, resets at UTC midnight.
    Lost your key? <a href="/keys">Generate a new one</a>.
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

    // Only handle /keys (and /keys/ with trailing slash)
    if (url.pathname !== '/keys' && url.pathname !== '/keys/') {
      return new Response('Not found', { status: 404 });
    }

    // GET /keys?key=<value> → success page
    const keyParam = url.searchParams.get('key');
    if (request.method === 'GET' && keyParam) {
      return new Response(renderSuccessPage(keyParam), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // GET /keys → landing page
    if (request.method === 'GET') {
      return new Response(renderLandingPage(), {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // POST /keys → issue key
    if (request.method === 'POST') {
      let email = '';
      try {
        const body = await request.formData();
        email = (body.get('email') as string | null) ?? '';
      } catch {
        return new Response(renderLandingPage('Invalid form submission.'), {
          status: 400,
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      if (!isValidEmail(email)) {
        return new Response(renderLandingPage('Please enter a valid email address.'), {
          status: 400,
          headers: { 'Content-Type': 'text/html;charset=UTF-8' },
        });
      }

      const key = generateKey();
      const emailHash = await hashEmail(email);

      const record: KeyRecord = {
        tier: 'free',
        created: new Date().toISOString(),
        email_hash: emailHash,
      };

      await env.VALID_API_KEYS.put(key, JSON.stringify(record));

      // Redirect to success page — key in URL param, not body (avoids resubmit on refresh)
      return new Response(null, {
        status: 303,
        headers: { Location: `/keys?key=${encodeURIComponent(key)}` },
      });
    }

    return new Response('Method not allowed', { status: 405 });
  },
};
