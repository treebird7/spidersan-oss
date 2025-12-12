# GitHub Secrets Setup for Spidersan

## Required Secrets

Go to: **GitHub repo → Settings → Secrets and variables → Actions → New repository secret**

### For Supabase Migrations

| Secret Name | Description | Where to Get |
|-------------|-------------|--------------|
| `SUPABASE_URL` | Spidersan's Supabase project URL | Supabase Dashboard → Settings → API → Project URL |
| `SUPABASE_KEY` | Supabase anon/public key | Supabase Dashboard → Settings → API → anon key |

### For npm Publishing

| Secret Name | Description | Where to Get |
|-------------|-------------|--------------|
| `NPM_TOKEN` | npm access token for publishing | npmjs.com → Access Tokens → Generate New Token (Automation) |

## Workflow Triggers

### CI (`ci.yml`)
- **Trigger:** Push to main/docs, PRs to main
- **Secrets needed:** None
- **What it does:** Build, test CLI commands

### Migrations (`migrations.yml`)
- **Trigger:** Push to main with changes in `migrations/*.sql`
- **Secrets needed:** `SUPABASE_URL`, `SUPABASE_KEY`
- **What it does:** Auto-applies new migrations to Supabase

### Publish (`publish.yml`)
- **Trigger:** GitHub Release published, or manual dispatch
- **Secrets needed:** `NPM_TOKEN`
- **What it does:** Publishes to npm registry

## Creating an npm Token

1. Go to [npmjs.com](https://www.npmjs.com)
2. Sign in (or create account)
3. Click your avatar → Access Tokens
4. Generate New Token → Automation (for CI)
5. Copy the token and add as `NPM_TOKEN` secret

## Creating a Spidersan Supabase Project

For full standalone independence from Recovery-Tree:

1. Go to [supabase.com](https://supabase.com)
2. Create new project (e.g., "spidersan-prod")
3. Copy the URL and anon key
4. Add as `SUPABASE_URL` and `SUPABASE_KEY` secrets
5. Run the setup migration:
   - Go to SQL Editor
   - Paste contents of `migrations/000_setup_schema.sql`
   - Run
6. Apply base migrations:
   - `migrations/001_branch_registry.sql` (if needed)
   - `migrations/040_agent_messages.sql` (if needed)

## Verification

After adding secrets, you can:

1. **Test migrations:** Go to Actions → Apply Migrations → Run workflow
2. **Test publish:** Create a release or run manually (needs NPM_TOKEN)

## Notes

- Never commit actual secrets to the repo
- The `.env` file is for local development only
- GitHub Secrets are encrypted and only accessible in Actions
