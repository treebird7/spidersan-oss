---
name: setup-oidc-autoregister
description: Set up zero-secret Spidersan auto-register on YOUR OWN repo + Supabase project (BYK). Deploys the register-branch edge function, wires an sb_secret key server-side, adds the push workflow, and proves the OIDC path end-to-end. Use when asked to "set up auto-register", "add spidersan CI registration", or adopt spidersan branch tracking in a new repo/org.
---

# /setup-oidc-autoregister — BYK OIDC auto-register

Registers every pushed branch (name, agent, changed files) in your own
Supabase `branch_registry` — **with zero secrets in your GitHub repo**.
CI mints a short-lived GitHub OIDC token; a Supabase edge function you
deploy verifies it and writes the registry server-side.

Source of truth (this repo):
- function: `supabase/functions/register-branch/index.ts`
- workflow: `.github/workflows/auto-register.yml`
- design notes: README § "GitHub Actions Auto-Register (OIDC)" and PR #279

## Security invariants — enforce, don't negotiate

1. The `sb_secret_*` key lives ONLY in Supabase function secrets
   (`supabase secrets set`). NEVER in GitHub repo/org secrets, NEVER in
   the workflow, NEVER echoed to chat/logs. Pass it via command
   substitution from wherever the user keeps it.
2. `REGISTRY_ALLOWED_REPOS` MUST be set to the user's `owner/repo`. The
   `repository` claim is the only real gate — the audience string is not
   a boundary (any GitHub repo can mint a token with it).
3. Deploy with `--no-verify-jwt` — the function does its own OIDC
   verification; platform JWT check would reject GitHub tokens.
4. Legacy `service_role` JWT (starts `eyJ`) is NOT acceptable — require a
   new-style secret key (starts `sb_secret_`). Check without printing:
   `<key-source> | grep -c '^sb_secret_'` must output `1`.

## Prerequisites

- Supabase project (theirs) + `supabase` CLI logged in
- `branch_registry` table — apply `supabase/migrations/20251213100001_registry.sql`
  (+ `20260220_branch_registry_machine_id.sql` for `repo_name`) if absent
- GitHub repo admin (to set one Actions **variable** — not a secret)

## Steps

1. **Copy the function** into their repo (or deploy straight from a
   spidersan-oss checkout):
   `supabase/functions/register-branch/index.ts` — no edits needed.

2. **Deploy + wire secrets** (REF = their project ref):
   ```bash
   supabase functions deploy register-branch --no-verify-jwt --use-api --project-ref $REF
   supabase secrets set --project-ref $REF \
     REGISTRY_SB_SECRET="$(<their-key-source>)" \
     REGISTRY_ALLOWED_REPOS="<owner/repo>"
   ```
   Optional hardening: `REGISTRY_ALLOWED_REPO_IDS=<numeric id>` — get it via
   `gh api repos/<owner/repo> -q .id`; immune to repo-name resquatting.

3. **Add the workflow**: copy `.github/workflows/auto-register.yml`
   verbatim into their repo. It no-ops until the variable exists, so the
   copy is safe to merge first.

4. **Set the repo variable** (variable, not secret — the URL is public):
   ```bash
   gh variable set SPIDERSAN_REGISTER_URL --repo <owner/repo> \
     --body "https://$REF.supabase.co/functions/v1/register-branch"
   ```

## Verify — all four, in order

```bash
FN=https://$REF.supabase.co/functions/v1/register-branch
curl -s -o /dev/null -w '%{http_code}\n' $FN                       # 405
curl -s -o /dev/null -w '%{http_code}\n' -X POST $FN               # 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Authorization: Bearer garbage' $FN  # 401
```

Happy path: push a throwaway branch, watch the `Spidersan Auto-Register`
run go green, then confirm the row (server-side key, count only is fine).
Clean up: delete the branch, PATCH the row to `state: "abandoned"`.

A verify pass = all three reject codes exact AND the probe row exists
with `created_by_session: "github-actions"` and the right `repo_name`.
Anything less is not a pass.

## Semantics to explain to the user

- New branch → INSERT, state `active`, agent parsed from branch prefix
  (`alice/feature` → `alice`), else the push actor.
- Existing branch → only `files_changed` refreshed. A push can never
  re-activate a merged branch or overwrite attribution (also neutralizes
  token replay).
- `main` and `staging/*` pushes are ignored by the workflow.
