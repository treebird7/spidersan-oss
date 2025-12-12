# Multi-Environment Setup Guide

## Overview

Spidersan now supports multiple Supabase environments:
- **Production:** For stable, merged code and coordination
- **Staging:** For testing unmerged branches and experimental features
- **Local:** File-based storage (no Supabase required)

## Environment Configuration

### 1. Update Your `.env` File

```bash
# Current environment (production, staging, or local)
SPIDERSAN_ENV=production

# Production Supabase (main project)
SUPABASE_URL_PROD=https://your-production-project.supabase.co
SUPABASE_KEY_PROD=your_production_anon_key

# Staging Supabase (for testing unmerged branches)
SUPABASE_URL_STAGING=https://your-staging-project.supabase.co
SUPABASE_KEY_STAGING=your_staging_anon_key

# Legacy (for backward compatibility - optional)
SUPABASE_URL=${SUPABASE_URL_PROD}
SUPABASE_KEY=${SUPABASE_KEY_PROD}
```

### 2. Or Use `.spidersanrc`

```json
{
  "storage": {
    "environment": "production",
    "supabaseUrl": "https://prod.supabase.co",
    "supabaseKey": "prod_key",
    "supabaseUrlStaging": "https://staging.supabase.co",
    "supabaseKeyStaging": "staging_key"
  }
}
```

## Usage

### Use Production (Default)
```bash
# Uses SUPABASE_URL_PROD and SUPABASE_KEY_PROD
spidersan list
```

### Use Staging
```bash
# Set environment variable
SPIDERSAN_ENV=staging spidersan list

# Or export it
export SPIDERSAN_ENV=staging
spidersan list
```

### Use Local Storage
```bash
SPIDERSAN_ENV=local spidersan list
```

## Environment Selection Priority

The system selects the environment in this order:
1. CLI flag (future feature: `--env staging`)
2. `SPIDERSAN_ENV` environment variable
3. `.spidersanrc` config file
4. Default: `production`

## Use Cases

### Production Environment
- Stable, merged branches only
- Main team coordination
- Production messaging between agents

### Staging Environment
- Test merges before production
- Experimental branch coordination
- Safe testing of new agent workflows
- separate from production data

### Local Environment
- No internet connection
- Single-developer projects
- Quick testing
- No Supabase account needed

## Migration Between Environments

To copy branches from production to staging:
```bash
# Export from production
SPIDERSAN_ENV=production spidersan list --json > branches.json

# Import to staging (manual process)
SPIDERSAN_ENV=staging spidersan register --from-file branches.json
```

## Benefits

✅ Test risky merges in staging first  
✅ Keep production clean and stable  
✅ Isolate agent experiments  
✅ Easy rollback strategy  
✅ Separate coordination from production data
