# Spidersan Migration Strategy

## Setup Overview

**Staging Supabase Project:** Used for test branches and Spidersan coordination  
**Strategy:** Dual-safety (Separate schemas + Number ranges)

## Migration Number Allocation

### Recovery-Tree: 001-199
- Existing migrations continue as normal
- Plenty of room for growth (199 total slots)
- Example: `040_agent_messages.sql`, `041_next_feature.sql`

### Spidersan: 200-299
- All Spidersan-specific migrations start at 200
- Example: `200_spidersan_init.sql`, `201_spidersan_config.sql`

### Shared/Future: 300-399
- Reserved for new shared infrastructure
- Coordinated between both repos

## Schema Organization

### `public` schema (Shared)
✅ Already exists:
- `agent_messages` - Cross-agent communication
- `branch_registry` - Branch coordination

### `spidersan` schema (Spidersan-only)
For Spidersan-specific tables:
- `spidersan.config` - Spidersan configuration
- `spidersan.analytics` - Usage tracking (if needed)
- `spidersan.cli_sessions` - CLI session logs (if needed)

### `recovery_tree` schema (Recovery-Tree-only)
For Recovery-Tree-specific tables:
- Already has tables in `public` (users, sessions, etc.)
- Can migrate to `recovery_tree` schema if desired

## Implementation Steps

### 1. Create Spidersan Schema
```sql
-- Run in Supabase SQL Editor (staging project)
CREATE SCHEMA IF NOT EXISTS spidersan;

GRANT USAGE ON SCHEMA spidersan TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA spidersan TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA spidersan TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA spidersan TO anon, authenticated;

-- Default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan 
  GRANT ALL ON TABLES TO anon, authenticated;
```

### 2. Update Spidersan Migration Template
```sql
-- migrations/100_example.sql
-- Migration: 100 - Example Migration
-- Description: What this migration does
-- Schema: spidersan

BEGIN;

-- Your changes here
CREATE TABLE IF NOT EXISTS spidersan.example_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;
```

### 3. Configure Environment
```bash
# .env
SPIDERSAN_ENV=staging
SUPABASE_URL_STAGING=https://your-staging-project.supabase.co
SUPABASE_KEY_STAGING=your_staging_key
```

## Migration Workflow

### Spidersan Migrations
1. Create migration file: `migrations/2XX_feature_name.sql`
2. Always use `spidersan` schema for new tables
3. Use `public` schema only for shared tables (agent_messages, branch_registry)
4. Apply via Supabase dashboard or CLI

### Recovery-Tree Migrations
1. Continue using 001-199 range
2. Keep using current schema pattern
3. Shared tables stay in `public`

## Collision Prevention

✅ **Number ranges:** Spidersan 200+, Recovery-Tree <200  
✅ **Schemas:** Spidersan-specific in `spidersan`, shared in `public`  
✅ **Project:** Staging (separate from production)

**Zero collision risk!**

## Example Migration

```sql
-- migrations/200_spidersan_config.sql
BEGIN;

CREATE TABLE IF NOT EXISTS spidersan.config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE spidersan.config ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_all ON spidersan.config
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;
```

## Benefits

1. ✅ No migration number collisions (different ranges)
2. ✅ No table name collisions (different schemas)
3. ✅ Clean separation of concerns
4. ✅ Shared tables work for both repos
5. ✅ Can evolve independently
6. ✅ Easy to identify what belongs to which repo

## When to Use Each Schema

**Use `public` for:**
- Cross-repo coordination (agent_messages, branch_registry)
- Tables both repos need to read/write

**Use `spidersan` for:**
- Spidersan-only configuration
- Spidersan analytics/logging
- CLI-specific data

**Use `recovery_tree` for:**
- Recovery-Tree business logic (if migrating from public)
- App-specific tables
