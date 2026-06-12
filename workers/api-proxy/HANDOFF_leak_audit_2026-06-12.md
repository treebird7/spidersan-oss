# Handoff — api.spidersan.net leak audit & fix (2026-06-12)

**Goal:** ensure the hosted spidersan API does not return local/serving-machine
information (the M5 box running `mlx_lm.server`) to API clients.

**Branch:** `claude/claude-md-docs-l08eik` (both `spidersan-oss` and `spidersan-ai`)

---

## Architecture (confirmed)

```
client → api.spidersan.net/v1/*
       → [CF Worker: spidersan-api-proxy]  workers/api-proxy/src/index.ts
       → MODEL_BACKEND_URL (spidersan-model.treebird.uk, CF-Access-gated tunnel)
       → M5 mlx_lm.server :8095   ← the "serving machine"
```

---

## 1. Proxy patch — DONE (commit `c5a920d`, needs deploy)

`workers/api-proxy/src/index.ts`. `tsc --noEmit` passes. Closed 3 leak channels
in the `/v1/chat/completions` response path (it used to forward the backend body
+ headers verbatim):

| # | Leak | Fix |
|---|------|-----|
| 1 | Response `model` field echoed internal `MODEL_ID` (`sweep-m5-…-a095/fused`) | Rewrite to `spidersan-v1` — non-streaming (parse JSON) **and** SSE streaming (`scrubModelIdStream`, chunk-boundary-safe). Symmetric with the existing M2 `/v1/models` normalization. |
| 2 | Backend error bodies (uvicorn tracebacks, `/Users/…` paths) forwarded verbatim | On `!backendResp.ok` → generic message + coarse status (5xx→502, 4xx→400). `fetch()` failure → generic `502 Backend unavailable` (no underlying error string). |
| 3 | Backend response headers (`Server`/version fingerprint) forwarded verbatim | `safeResponseHeaders()` allowlist: `Content-Type`, optional `Cache-Control`, our `X-RateLimit-*`. |

**TODO to ship:**
```bash
cd workers/api-proxy
npm install
npm run typecheck      # expect exit 0
npm run deploy         # wrangler deploy  (prod: api.spidersan.net/v1/*)
```

---

## 2. Training-data audit — DONE, clean

Checked `spidersan-ai` for local paths the model could regurgitate:

- `eval/EVAL_gitmaze_v1.json` and `SYSTEM_PROMPT` (`scripts/eval-gitmaze.py`): **0** hits.
- Only pair containing a local path — `pairs/session_20260504_Mac_002.json`
  (`cd /Users/freedbird/Dev/treebird-internal`) — is a **raw session capture, NOT
  in the v3/v4 training pool**. The v3/v4 scripts load only `p5_*`,
  `haiku_distill_*`, `v4_*` + Supabase `eval_set_gold`. So the model was never
  trained on it. (Optional cleanup: scrub/remove that file; it also exposes the
  private repo name `treebird-internal`.)
- `/Users/freedbird`, `mlx-finetune-venv`, `output/sweep-m5-…` appear only in
  training **shell scripts** (build infra) — never fed to the model.

**Caveat (not auditable from the repo):** the 128 `eval_set_gold` pairs are pulled
from Supabase at train time. One-time server-side check recommended:
```sql
-- against the eval_set_gold rows
select id from <gold_table>
where text ~ '/Users/|/home/|192\.168|10\.0\.|localhost|\.local';
```

---

## 3. Live-test — BLOCKED, queued

Could not run from the cloud session: this environment's **network egress policy
denies `api.spidersan.net`** (egress proxy returned `403 x-deny-reason:
host_not_allowed`, NOT the worker's 401). The API key was never the blocker.

### To run later, prerequisites:
1. **Deploy the patched worker** (§1) so the test validates the fix, not the old code.
2. **Egress:** if testing from a cloud session, add `api.spidersan.net` to the
   environment's network egress allowlist
   (https://code.claude.com/docs/en/claude-code-on-the-web). From a normal local
   shell this is a non-issue.
3. **Key:** prefer an env var over pasting in chat; rotate via the keys worker after.
   ```bash
   export SPIDERSAN_KEY=<key>
   ```

### Test commands (paste-ready)

```bash
# A. models endpoint — must show ONLY the public alias, no FS path
curl -s https://api.spidersan.net/v1/models \
  -H "Authorization: Bearer $SPIDERSAN_KEY" | jq .
#   expect: data[0].id == "spidersan-v1"   (NOT sweep-m5-…/fused)

# B. chat completion — response `model` must be the alias
curl -s https://api.spidersan.net/v1/chat/completions \
  -H "Authorization: Bearer $SPIDERSAN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"spidersan-v1","messages":[{"role":"user","content":"hi"}]}' \
  | jq '.model'
#   expect: "spidersan-v1"   (NOT the internal MODEL_ID)

# C. response headers — no backend fingerprint
curl -s -D - -o /dev/null https://api.spidersan.net/v1/chat/completions \
  -H "Authorization: Bearer $SPIDERSAN_KEY" -H "Content-Type: application/json" \
  -d '{"model":"spidersan-v1","messages":[{"role":"user","content":"hi"}]}'
#   expect: Content-Type, X-RateLimit-* only. NO Server: uvicorn / Python / version.

# D. force a backend error — must be generic, no path/traceback
curl -s https://api.spidersan.net/v1/chat/completions \
  -H "Authorization: Bearer $SPIDERSAN_KEY" -H "Content-Type: application/json" \
  -d '{"model":"spidersan-v1","messages":"not-an-array"}' | jq .
#   expect: {"error":{"message":"Backend rejected the request", ...}}
#   FAIL if you see /Users/…, a stack trace, or a hostname.

# E. (optional) streaming — alias must hold across SSE chunks
curl -s -N https://api.spidersan.net/v1/chat/completions \
  -H "Authorization: Bearer $SPIDERSAN_KEY" -H "Content-Type: application/json" \
  -d '{"model":"spidersan-v1","stream":true,"messages":[{"role":"user","content":"hi"}]}' \
  | grep -i 'sweep-m5\|/Users/\|fused' && echo "LEAK" || echo "clean"
```

**Pass = clean on A–E.** Any `sweep-m5…`, `/Users/…`, `fused`, hostname, or
`Server:` backend header in the output is a regression — re-check the deploy.

---

## Status checklist
- [x] Proxy patch written + typechecked + pushed (`c5a920d`)
- [ ] `wrangler deploy` the patched worker
- [x] Training-data audit (repo) — clean
- [ ] Supabase `eval_set_gold` server-side grep (caveat)
- [ ] Live-test A–E once worker deployed + egress open
- [ ] (optional) scrub `pairs/session_20260504_Mac_002.json`
