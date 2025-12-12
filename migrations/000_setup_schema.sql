-- Spidersan Schema Setup
-- Run this in Supabase SQL Editor (staging project)

BEGIN;

-- Create spidersan schema
CREATE SCHEMA IF NOT EXISTS spidersan;

-- Grant permissions to anon and authenticated roles
GRANT USAGE ON SCHEMA spidersan TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA spidersan TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA spidersan TO anon, authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA spidersan TO anon, authenticated;

-- Set default privileges for future objects
ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan 
  GRANT ALL ON TABLES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan 
  GRANT ALL ON SEQUENCES TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA spidersan 
  GRANT ALL ON FUNCTIONS TO anon, authenticated;

-- Create a test table to verify schema works
CREATE TABLE IF NOT EXISTS spidersan._schema_test (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON SCHEMA spidersan IS 'Spidersan CLI-specific tables and data';
COMMENT ON TABLE spidersan._schema_test IS 'Test table to verify schema setup - safe to delete';

COMMIT;

-- Verify setup
SELECT schema_name 
FROM information_schema.schemata 
WHERE schema_name = 'spidersan';
