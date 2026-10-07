-- Expected participants for a split. Payment status is derived from
-- split_payments, while this table identifies who is expected to pay.
create table if not exists public.split_participants (
  split_id text not null references public.splits(split_id) on delete cascade,
  wallet_address text not null,
  display_name text,
  created_at bigint not null,
  primary key (split_id, wallet_address)
);

create index if not exists split_participants_wallet_idx
  on public.split_participants (wallet_address);

alter table public.split_participants enable row level security;
