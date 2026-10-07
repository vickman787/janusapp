-- A wallet may intentionally cover more than one share on JanusSplitV2.
-- Keep each confirmed payment as its own record, identified by transaction.
alter table public.split_payments
  drop constraint if exists split_payments_pkey;

alter table public.split_payments
  add constraint split_payments_pkey primary key (split_id, tx_hash);
