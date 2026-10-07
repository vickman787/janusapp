-- Username identity layer for JANUS.
create table if not exists public.split_participants (
  split_id text not null references public.splits(split_id) on delete cascade,
  wallet_address text not null,
  display_name text,
  username_snapshot text,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  tx_hash text,
  created_at bigint not null,
  primary key (split_id, wallet_address)
);

create table if not exists public.profiles (
  wallet_address text primary key,
  username text not null,
  created_at bigint not null
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

alter table public.split_participants
  add column if not exists username_snapshot text;

alter table public.split_participants
  add column if not exists status text not null default 'pending';

alter table public.split_participants
  add column if not exists tx_hash text;

alter table public.split_participants
  drop constraint if exists split_participants_status_check;

alter table public.split_participants
  add constraint split_participants_status_check
  check (status in ('pending', 'paid'));

alter table public.profiles enable row level security;
