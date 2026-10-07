-- Supports the private Payments Due inbox without changing organiser cards.
create index if not exists split_participants_wallet_status_idx
  on public.split_participants (wallet_address, status);
