# Fixing Supabase Function Search Path Security Warnings

**Issue ID:** `0011_function_search_path_mutable`
**Severity:** WARN
**Category:** SECURITY
**Date Fixed:** 2025-12-17
**Project:** Spidersan (treebird7/Spidersan)

## What Was Broken

Supabase's database linter flagged 4 PostgreSQL functions with security warnings:

```
function_search_path_mutable - Function Search Path Mutable
Level: WARN | Facing: EXTERNAL | Category: SECURITY

Affected functions:
1. public.handle_new_user
2. public.update_updated_at_column
3. public.update_branch_registry_timestamp
4. public.mark_message_read
```

## Why This Matters (Security Risk)

PostgreSQL functions without an explicit `search_path` are vulnerable to **schema-based SQL injection attacks**:

1. **Attack Vector:** Malicious users can manipulate the session's `search_path`
2. **Exploit Method:** Create a malicious schema with the same table names
3. **Result:** Function executes against wrong tables, potentially leaking data or corrupting the database

**Example Attack:**
```sql
-- Attacker creates malicious schema
CREATE SCHEMA evil;
CREATE TABLE evil.agent_messages (...); -- Same structure, logs all data

-- Attacker sets search_path
SET search_path = evil, public;

-- Your function now writes to evil.agent_messages instead of public.agent_messages
SELECT mark_message_read('some-uuid');
```

## How to Detect This in Your Project

### Method 1: Supabase Dashboard (Recommended)
1. Go to your Supabase project dashboard
2. Navigate to **Database** → **Linter**
3. Look for warnings with name: `function_search_path_mutable`

### Method 2: SQL Query
Run this in your Supabase SQL editor:

```sql
-- Find all functions without search_path set
SELECT
  n.nspname as schema,
  p.proname as function_name,
  pg_get_functiondef(p.oid) as definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND (proconfig IS NULL OR NOT EXISTS (
    SELECT 1 FROM unnest(proconfig) AS config
    WHERE config LIKE 'search_path=%'
  ))
ORDER BY p.proname;
```

## The Fix (Step-by-Step)

### Step 1: Add `SET search_path = ''` to Function Definitions

**Before:**
```sql
CREATE OR REPLACE FUNCTION mark_message_read(message_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE agent_messages
  SET read = true, read_at = NOW()
  WHERE id = message_id;
END;
$$ LANGUAGE plpgsql;
```

**After:**
```sql
CREATE OR REPLACE FUNCTION mark_message_read(message_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.agent_messages  -- ⚠️ IMPORTANT: Add schema prefix!
  SET read = true, read_at = NOW()
  WHERE id = message_id;
END;
$$ LANGUAGE plpgsql
SET search_path = '';  -- ← Add this line
```

### Step 2: Schema-Qualify All Table References

**CRITICAL:** When `search_path = ''`, all table references MUST include schema prefix:

| ❌ Wrong | ✅ Correct |
|---------|-----------|
| `UPDATE agent_messages` | `UPDATE public.agent_messages` |
| `INSERT INTO users` | `INSERT INTO public.users` |
| `SELECT * FROM branch_registry` | `SELECT * FROM public.branch_registry` |

**Exception:** Variables like `NEW` and `OLD` in triggers don't need prefixes.

### Step 3: Fix Existing Functions (Migration Pattern)

For functions you DON'T have the original definition for, use `ALTER FUNCTION`:

```sql
-- Safe pattern: Preserves existing logic, just adds security
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'your_function_name'
  ) THEN
    ALTER FUNCTION public.your_function_name() SET search_path = '';
    RAISE NOTICE 'Fixed your_function_name()';
  ELSE
    RAISE NOTICE 'Function your_function_name() not found - skipping';
  END IF;
END $$;
```

## What We Fixed in Spidersan

### Functions Fixed

**1. `update_branch_registry_timestamp()`** (Trigger function)
```sql
CREATE OR REPLACE FUNCTION public.update_branch_registry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();  -- No table refs, safe as-is
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';
```

**2. `mark_message_read()`** (Function with table reference)
```sql
CREATE OR REPLACE FUNCTION public.mark_message_read(message_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.agent_messages  -- Added public. prefix
  SET read = true, read_at = NOW()
  WHERE id = message_id;
END;
$$ LANGUAGE plpgsql
SET search_path = '';
```

**3. `handle_new_user()` & `update_updated_at_column()`** (External functions)
- Used `ALTER FUNCTION` pattern to preserve unknown logic
- See migration: `supabase/migrations/20251217000000_fix_search_path_security.sql`

### Files Modified

**Migration Files:**
- ✅ `migrations/201_branch_registry.sql`
- ✅ `migrations/202_agent_messages.sql`
- ✅ `supabase/migrations/20251213100001_registry.sql`
- ✅ `supabase/migrations/20251213100002_messages.sql`
- ✅ `supabase/migrations/20251217000000_fix_search_path_security.sql` (new)

**Git Commits:**
- `30fbb6c` - Initial search_path fixes
- `b55d72a` - Schema qualification fix (critical!)

## Common Pitfalls & Solutions

### Pitfall 1: Forgetting Schema Prefix
**Symptom:** Function runs successfully in migration but fails at runtime
```
ERROR: relation "agent_messages" does not exist
```

**Solution:** Add `public.` (or appropriate schema) to ALL table references

### Pitfall 2: Using `SECURITY DEFINER` Incorrectly
**Mistake:** Adding `SECURITY DEFINER` when you just need `search_path`
```sql
-- ❌ Probably wrong (changes who the function runs as)
$$ LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = '';
```

**Correct:** Only add `search_path` unless you specifically need `SECURITY DEFINER`
```sql
-- ✅ Correct (just security hardening)
$$ LANGUAGE plpgsql
SET search_path = '';
```

### Pitfall 3: Hardcoding Current Schema
**Mistake:** Using `current_schema()` or hardcoding the wrong schema
```sql
SET search_path = current_schema()  -- ❌ Defeats the purpose
SET search_path = 'my_schema'       -- ❌ Only if you need non-public
```

**Correct:** Use empty string for maximum security
```sql
SET search_path = ''  -- ✅ Forces explicit qualification
```

## Testing Your Fix

### 1. Run the Migration
```bash
# Using Supabase CLI
supabase db push

# Or manually in SQL Editor
# Copy/paste your migration file
```

### 2. Verify Functions Are Fixed
```sql
-- Should return your functions with search_path set
SELECT
  p.proname as function_name,
  proconfig as settings
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('mark_message_read', 'update_branch_registry_timestamp')
  AND proconfig IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(proconfig) AS config
    WHERE config LIKE 'search_path=%'
  );
```

Expected output:
```
function_name                    | settings
---------------------------------|------------------
mark_message_read                | {search_path=}
update_branch_registry_timestamp | {search_path=}
```

### 3. Test Functionality
Run operations that use these functions:

```bash
# Test message reading (uses mark_message_read)
spidersan inbox
spidersan read <message-id>

# Test branch updates (uses update_branch_registry_timestamp)
spidersan register --files test.ts --desc "Testing"
```

If these work without SQL errors, your fix is successful!

### 4. Re-run Supabase Linter
Check that warnings are gone in **Database** → **Linter**

## Migration Template for Other Projects

Use this template to fix your own functions:

```sql
-- Migration: Fix search_path security warnings
-- Date: [TODAY]
-- Reference: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

BEGIN;

-- Replace with your actual functions
CREATE OR REPLACE FUNCTION public.your_function_name(params)
RETURNS return_type AS $$
BEGIN
  -- ⚠️ IMPORTANT: Add schema prefix to all table references!
  UPDATE public.your_table
  SET column = value
  WHERE condition;

  RETURN result;
END;
$$ LANGUAGE plpgsql
SET search_path = '';  -- ← Add this

-- For functions you don't have definitions for:
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'unknown_function'
  ) THEN
    ALTER FUNCTION public.unknown_function() SET search_path = '';
  END IF;
END $$;

-- Verify fix
DO $$
DECLARE
  func_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN ('your_function_name', 'unknown_function')
    AND EXISTS (
      SELECT 1 FROM unnest(proconfig) AS config
      WHERE config LIKE 'search_path=%'
    );

  RAISE NOTICE 'Fixed % functions', func_count;
END $$;

COMMIT;
```

## References

- [Supabase Database Linter Docs](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [PostgreSQL search_path Security](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATH)
- [Spidersan Fix PR](https://github.com/treebird7/Spidersan/pull/new/claude/fix-supabase-errors-yWOgk)

## Summary Checklist

For other projects experiencing this issue:

- [ ] Run Supabase linter to identify affected functions
- [ ] Add `SET search_path = ''` to all flagged functions
- [ ] Add schema prefix (e.g., `public.`) to all table references in those functions
- [ ] Create migration file using template above
- [ ] Test migration in development/staging first
- [ ] Apply to production
- [ ] Verify with linter that warnings are resolved
- [ ] Test affected functionality

---

**Need Help?** Reference this fix in the Spidersan repository:
- Migration: `supabase/migrations/20251217000000_fix_search_path_security.sql`
- Commits: `30fbb6c`, `b55d72a`
- Branch: `claude/fix-supabase-errors-yWOgk`
