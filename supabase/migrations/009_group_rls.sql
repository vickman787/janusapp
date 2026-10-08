-- Ensure organizer groups remain server-only like the rest of JANUS data.
-- This is separate from migration 008 so projects that already applied 008
-- also receive the RLS hardening.
alter table if exists public.groups enable row level security;
alter table if exists public.group_members enable row level security;
