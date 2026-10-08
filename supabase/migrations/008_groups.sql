-- Reusable organiser-owned groups for recurring splits.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  organizer_wallet_address text not null,
  name text not null,
  created_at bigint not null,
  updated_at bigint not null,
  constraint groups_name_length check (char_length(name) between 1 and 80)
);

create unique index if not exists groups_organizer_name_unique
  on public.groups (organizer_wallet_address, lower(name));
create index if not exists groups_organizer_created_idx
  on public.groups (organizer_wallet_address, created_at desc);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  wallet_address text not null,
  username_snapshot text,
  created_at bigint not null,
  primary key (group_id, wallet_address)
);

create index if not exists group_members_wallet_idx
  on public.group_members (wallet_address);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

alter table public.splits
  add column if not exists group_id uuid references public.groups(id) on delete set null;

create index if not exists splits_group_created_idx
  on public.splits (group_id, created_at desc);
