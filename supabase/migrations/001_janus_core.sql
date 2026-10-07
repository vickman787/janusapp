-- JANUS hosted persistence schema.
-- The Next.js server uses the Supabase service-role key after Privy
-- authorization and verified on-chain receipt checks.

create table if not exists public.splits (
  split_id text primary key,
  title text not null,
  total_amount text not null,
  amount_per_person text not null,
  num_payers integer not null check (num_payers > 0),
  creator text not null,
  tx_hash text not null unique,
  created_at bigint not null,
  status text not null check (status in ('Active', 'Settled', 'Cancelled')),
  settled_count integer not null default 0 check (settled_count >= 0)
);

create table if not exists public.split_payments (
  split_id text not null references public.splits(split_id) on delete cascade,
  payer_address text not null,
  paid_at bigint not null,
  tx_hash text not null unique,
  amount text not null,
  primary key (split_id, payer_address)
);

create table if not exists public.activities (
  id text primary key,
  from_address text,
  to_address text,
  address text not null,
  type text not null,
  title text not null,
  amount text not null,
  timestamp bigint not null,
  is_positive boolean not null,
  tx_hash text,
  split_id text,
  counterparty text,
  status text
);

create table if not exists public.rate_limits (
  bucket_key text primary key,
  window_start bigint not null,
  request_count integer not null
);

create index if not exists splits_creator_created_idx
  on public.splits (creator, created_at desc);
create index if not exists split_payments_payer_idx
  on public.split_payments (payer_address, paid_at desc);
create index if not exists activities_address_time_idx
  on public.activities (address, timestamp desc);
create index if not exists activities_from_time_idx
  on public.activities (from_address, timestamp desc);
create index if not exists activities_to_time_idx
  on public.activities (to_address, timestamp desc);

alter table public.splits enable row level security;
alter table public.split_payments enable row level security;
alter table public.activities enable row level security;
alter table public.rate_limits enable row level security;

-- No browser/client policies are intentionally granted. All access goes
-- through the Next.js server after Privy authorization.
