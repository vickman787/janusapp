-- Preserve which deployed contract created each split.
-- Existing rows remain on the legacy contract; new rows may use V2.
alter table public.splits
  add column if not exists contract_address text;

update public.splits
set contract_address = lower('0x1c3F1382057F99b5dAd89855B919bB322792C66E')
where contract_address is null;

alter table public.splits
  alter column contract_address set default lower('0x1c3F1382057F99b5dAd89855B919bB322792C66E');

alter table public.splits
  alter column contract_address set not null;

create index if not exists splits_contract_address_idx
  on public.splits (contract_address);
