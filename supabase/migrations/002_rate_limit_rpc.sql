create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_start bigint,
  p_reset_at bigint
)
returns table (
  allowed boolean,
  limit_value integer,
  remaining integer,
  reset_at bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_window bigint;
  current_count integer;
begin
  delete from public.rate_limits
  where window_start < p_window_start - 120000;

  select window_start, request_count
    into current_window, current_count
    from public.rate_limits
   where bucket_key = p_bucket_key
   for update;

  if current_window is null or current_window <> p_window_start then
    insert into public.rate_limits(bucket_key, window_start, request_count)
    values (p_bucket_key, p_window_start, 1)
    on conflict (bucket_key) do update
      set window_start = excluded.window_start,
          request_count = excluded.request_count;
    return query select true, p_limit, greatest(0, p_limit - 1), p_reset_at;
    return;
  end if;

  if current_count >= p_limit then
    return query select false, p_limit, 0, p_reset_at;
    return;
  end if;

  update public.rate_limits
     set request_count = request_count + 1
   where bucket_key = p_bucket_key;
  return query select true, p_limit, greatest(0, p_limit - current_count - 1), p_reset_at;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, bigint, bigint)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, bigint, bigint)
  to service_role;
