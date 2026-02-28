-- Convert SECURITY DEFINER views to SECURITY INVOKER
-- Views created by the postgres role default to SECURITY DEFINER, which means
-- they bypass the caller's RLS policies. Recreate with security_invoker = on
-- so row-level security is enforced for the querying user.

-- active_branches (depends on branch_registry)
DROP VIEW IF EXISTS public.stale_branches;   -- drop dependant first
DROP VIEW IF EXISTS public.active_branches;

CREATE VIEW public.active_branches WITH (security_invoker = on) AS
SELECT *,
  EXTRACT(EPOCH FROM (NOW() - updated_at)) / 86400 AS days_since_update
FROM public.branch_registry
WHERE state NOT IN ('merged', 'abandoned')
ORDER BY updated_at DESC;

-- stale_branches (depends on active_branches)
CREATE VIEW public.stale_branches WITH (security_invoker = on) AS
SELECT * FROM public.active_branches
WHERE days_since_update > 7;

-- unread_agent_messages
DROP VIEW IF EXISTS public.unread_agent_messages;
CREATE VIEW public.unread_agent_messages WITH (security_invoker = on) AS
SELECT * FROM public.agent_messages
WHERE read = false
ORDER BY created_at DESC;

-- recent_file_shares
DROP VIEW IF EXISTS public.recent_file_shares;
CREATE VIEW public.recent_file_shares WITH (security_invoker = on) AS
SELECT * FROM public.agent_messages
WHERE message_type = 'file_share'
  AND attached_files IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;
