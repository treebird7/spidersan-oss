-- Enable RLS on chaos_windows (deployed from treesan-core to spidersan project)
-- chaos_windows is an internal treesan table and should not be accessible via PostgREST

ALTER TABLE public.chaos_windows ENABLE ROW LEVEL SECURITY;

-- Only Edge Functions (service_role) may read or write chaos windows
DROP POLICY IF EXISTS "Service role manages chaos windows" ON public.chaos_windows;
CREATE POLICY "Service role manages chaos windows"
  ON public.chaos_windows
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Deny anon / authenticated access at the grant level
REVOKE ALL ON TABLE public.chaos_windows FROM anon, authenticated;
