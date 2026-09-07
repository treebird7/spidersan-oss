-- registry_allowed_repos — the OIDC registry allowlist, moved out of the
-- write-only env var REGISTRY_ALLOWED_REPOS (sp-uuyg).
--
-- This table IS the auth gate for register-branch. index.ts:15: "the ONLY gate
-- is the verified `repository` claim (aud is not a boundary — any GitHub repo
-- can mint a token with our audience)." A row here is a grant.
--
-- The REVOKE below is load-bearing, not belt-and-braces: this project's default
-- ACL for schema public is `anon=arwdt/postgres, authenticated=arwdt/postgres`,
-- so a bare CREATE TABLE hands anon INSERT/UPDATE/DELETE. RLS then blocks it,
-- but that leaves one layer between the public internet and the gate. Two.

create table if not exists public.registry_allowed_repos (
  repo_name  text primary key
             check (repo_name = lower(repo_name) and repo_name like '%/%'),
  repo_id    bigint,
  added_by   text        not null,
  added_at   timestamptz not null default now(),
  note       text
);

comment on table public.registry_allowed_repos is
  'register-branch OIDC allowlist. A row is an auth grant — service_role only.';

revoke all on public.registry_allowed_repos from anon, authenticated;

alter table public.registry_allowed_repos enable row level security;

-- service_role has BYPASSRLS, so this policy is currently decorative. It stays
-- explicit so the intent survives if that attribute is ever dropped, and so a
-- reader sees the grant list rather than inferring it from a role attribute.
drop policy if exists "Service role manages registry allowlist" on public.registry_allowed_repos;
create policy "Service role manages registry allowlist"
  on public.registry_allowed_repos for all to service_role
  using (true) with check (true);

-- SEEDING IS DELIBERATELY NOT IN THIS FILE. This repo is public and most of
-- the allowlisted repos are private, so the row set is applied out-of-band
-- against the project rather than published here. Seeded 2026-09-07 with the
-- 13 repos that actually have the SPIDERSAN_REGISTER_URL actions variable set,
-- enumerated per repo by exit code + a .name check (a bare `gh api --jq` test
-- matches the 404 body — that is what produced the wrong "68" in tb-6gex).
--
--   insert into public.registry_allowed_repos (repo_name, added_by, note)
--   values ('<owner>/<repo>', '<agent>', '<why>');
