-- Physical separation is tracked independently from lot registration.
alter table public.lots
  add column if not exists moved_at timestamptz;

-- Legacy stock deductions remain intact. Their physical box location cannot
-- be inferred reliably, so staff can mark them moved from the separation report.

create index if not exists lots_separation_movement_idx
  on public.lots (shipping_date, moved_at, status);

create or replace function public.move_lots_to_customer_boxes(p_lot_ids uuid[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_lot record;
begin
  if coalesce(array_length(p_lot_ids, 1), 0) < 1 or array_length(p_lot_ids, 1) > 100 then
    raise exception 'Selecione entre 1 e 100 lotes.';
  end if;
  if (select count(distinct x) from unnest(p_lot_ids) x) <> array_length(p_lot_ids, 1) then
    raise exception 'A seleção contém lotes duplicados.';
  end if;
  if not public.has_staff_write() then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  perform 1 from public.lots l
  where l.id = any(p_lot_ids)
    and l.status = 'paid'
    and l.moved_at is null
  for update;
  get diagnostics v_count = row_count;
  if v_count <> array_length(p_lot_ids, 1) then
    raise exception 'Um ou mais lotes não estão disponíveis para movimentação.';
  end if;

  -- Debit inventory in the same transaction as marking the lots moved.
  for v_lot in select l.id from public.lots l where l.id = any(p_lot_ids) order by l.id loop
    perform public.reconcile_lot_items(
    v_lot.id,
    (select jsonb_agg(jsonb_build_object('stock_item_id', li.stock_item_id, 'qty', li.qty))
     from public.lot_items li where li.lot_id = v_lot.id),
    true
    );
  end loop;

  update public.lots
  set moved_at = now()
  where id = any(p_lot_ids) and moved_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.move_lots_to_customer_boxes(uuid[]) from public, anon;
grant execute on function public.move_lots_to_customer_boxes(uuid[]) to authenticated;
