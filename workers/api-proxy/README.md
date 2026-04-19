# spidersan API Proxy

Cloudflare Worker powering `api.spidersan.dev`.

Proxies `/v1/chat/completions` and `/v1/models` to the private fine-tuned model backend with per-key auth and advisory rate limiting.

## Setup

```bash
npm install
wrangler login

# Create KV namespace
wrangler kv:namespace create VALID_API_KEYS

# Set production secret
wrangler secret put MODEL_BACKEND_URL
# → enter: https://model.internal.spidersan.dev

# Update wrangler.toml with the KV namespace IDs printed above
```

## Key Management

API keys are stored in the `VALID_API_KEYS` KV namespace:

```bash
# Add a key
wrangler kv:key put --binding=VALID_API_KEYS \
  "sk-spidersan-abc123" \
  '{"tier":"free","created":"2026-01-01T00:00:00Z","label":"user@example.com"}'

# Revoke a key
wrangler kv:key delete --binding=VALID_API_KEYS "sk-spidersan-abc123"
```

## Rate Limits

- Free tier: 100 req/hr (advisory KV counter, eventually consistent)
- Contributor tier: 100 req/hr (TODO: bump or remove limit)
- `X-RateLimit-Remaining` header returned on every response

> **Note:** KV rate limiting is advisory only (not atomic). For strict enforcement,
> migrate to Durable Objects (tracked as TODO P3-4).

## Deploy

```bash
npm run deploy             # production
npm run deploy:staging     # staging env
```
