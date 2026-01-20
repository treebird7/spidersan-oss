# Supabase Project Scoping Proposal

Problem
- The Supabase adapter supports a projectId in config, but queries are not scoped by repo or project.
- Multi-repo or multi-team usage on a shared Supabase instance can mix branch records and leak data.

Proposed schema changes
1) Add a `project_id` column to `branch_registry` (text, indexed).
2) Optionally add a `repo` column to disambiguate within a project.
3) Update views (`active_branches`, `stale_branches`) to include the same filter inputs.

Adapter changes
- Require a project identifier via env/config (e.g., `SPIDERSAN_PROJECT_ID`).
- Filter all list/get/register/update queries by `project_id`.
- Default to a safe namespace (e.g., `project_id = "default"`) when not provided.

RLS guidance
- Enforce `project_id` in RLS policies so clients can only access their own scope.
- Consider a read-only key for conflict checks and a write key for registration.

Migration plan
1) Add columns + indexes.
2) Backfill existing rows with `project_id = "default"`.
3) Update adapter queries and release a minor version.

Notes
- This aligns with existing `projectId` in the Supabase config but avoids breaking current users.
- If you cannot change the schema, document the limitation clearly and recommend separate Supabase projects.
