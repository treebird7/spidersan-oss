-- Fix search_path security warnings for all functions
-- Migration: Fix Function Search Path Mutable warnings
-- Date: 2025-12-17
-- Purpose: Add SET search_path = '' to all functions for security
-- Reference: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

BEGIN;

-- Fix 1: update_branch_registry_timestamp
-- This function updates the updated_at timestamp on branch_registry
CREATE OR REPLACE FUNCTION public.update_branch_registry_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Fix 2: mark_message_read
-- This function marks an agent message as read
CREATE OR REPLACE FUNCTION public.mark_message_read(message_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.agent_messages
  SET read = true, read_at = NOW()
  WHERE id = message_id;
END;
$$ LANGUAGE plpgsql
SET search_path = '';

-- Fix 3: handle_new_user (if exists - likely auth trigger)
-- This function handles new user creation in auth.users
-- Note: If this function doesn't exist in your schema, this will be skipped
DO $$
DECLARE
  func_def TEXT;
BEGIN
  -- Check if function exists
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) THEN
    -- Since we don't have the original function definition in migrations,
    -- we'll just add the search_path to the existing function
    -- This uses ALTER FUNCTION instead of CREATE OR REPLACE to preserve logic
    ALTER FUNCTION public.handle_new_user() SET search_path = '';
    RAISE NOTICE 'Fixed handle_new_user() function';
  ELSE
    RAISE NOTICE 'Function handle_new_user() not found - skipping';
  END IF;
END $$;

-- Fix 4: update_updated_at_column (if exists - generic timestamp updater)
-- This is a common generic function for updating updated_at columns
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
    RAISE NOTICE 'Fixed update_updated_at_column() function';
  ELSE
    RAISE NOTICE 'Function update_updated_at_column() not found - skipping';
  END IF;
END $$;

-- Verify all functions now have search_path set
DO $$
DECLARE
  func_count INTEGER;
  func_record RECORD;
BEGIN
  -- Count fixed functions
  SELECT COUNT(*) INTO func_count
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
    AND p.proname IN ('handle_new_user', 'update_updated_at_column',
                      'update_branch_registry_timestamp', 'mark_message_read')
    AND proconfig IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(proconfig) AS config
      WHERE config LIKE 'search_path=%'
    );

  RAISE NOTICE '✓ Fixed % functions with search_path security', func_count;

  -- List all fixed functions
  FOR func_record IN
    SELECT p.proname, n.nspname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname IN ('handle_new_user', 'update_updated_at_column',
                        'update_branch_registry_timestamp', 'mark_message_read')
      AND proconfig IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM unnest(proconfig) AS config
        WHERE config LIKE 'search_path=%'
      )
  LOOP
    RAISE NOTICE '  - %.%', func_record.nspname, func_record.proname;
  END LOOP;
END $$;

COMMIT;
