-- Compatibiliza a baixa de estoque com o search_path protegido da movimentação.
-- Não movimenta lotes existentes nem altera saldos ao aplicar a migration.
begin;
create or replace function public.reconcile_lot_items(
  p_lot_id uuid,
  p_items  jsonb,
  p_apply  boolean default true
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_lock_ids uuid[];
  v_row      record;
  v_deduct   int;
  v_target_qty       int;
  v_target_applied   boolean;
begin
  if p_lot_id is null then
    raise exception 'p_lot_id é obrigatório';
  end if;

  if not exists (select 1 from public.lots where id = p_lot_id) then
    raise exception 'Lote não encontrado';
  end if;

  -- valida os ids antes de qualquer escrita
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where not exists (
      select 1 from public.stock_items s
      where s.id = (e->>'stock_item_id')::uuid
    )
  ) then
    raise exception 'Item de estoque inexistente';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    where coalesce((e->>'qty')::int, 0) <= 0
  ) then
    raise exception 'Quantidade deve ser maior que zero';
  end if;

  select array_agg(distinct x.id) into v_lock_ids
  from (
    select (e->>'stock_item_id')::uuid as id
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
    union
    select l.stock_item_id
      from public.lot_items l
     where l.lot_id = p_lot_id
  ) x;

  if v_lock_ids is null then
    return;
  end if;

  perform 1 from public.stock_items where id = any(v_lock_ids) for update;

  for v_row in
    with desired as (
      select (e->>'stock_item_id')::uuid as stock_item_id,
             sum((e->>'qty')::int)::int  as qty
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
       group by 1
    ),
    current_rows as (
      select stock_item_id, qty, applied
        from public.lot_items
       where lot_id = p_lot_id
    ),
    keys as (
      select stock_item_id from desired
      union
      select stock_item_id from current_rows
    )
    select k.stock_item_id,
           coalesce(d.qty, 0)  as want_qty,
           coalesce(c.qty, 0)  as cur_qty,
           coalesce(c.applied, false) as cur_applied
      from keys k
      left join desired      d on d.stock_item_id = k.stock_item_id
      left join current_rows c on c.stock_item_id = k.stock_item_id
     order by k.stock_item_id
  loop
    if v_row.want_qty > 0 then
      v_target_qty     := v_row.want_qty;
      v_target_applied := coalesce(p_apply, true);
    else
      v_target_qty     := 0;
      v_target_applied := false;
    end if;

    -- quanto a prateleira deve mudar: positivo = sai, negativo = volta
    v_deduct :=
      (case when v_target_applied then v_target_qty     else 0 end)
      - (case when v_row.cur_applied then v_row.cur_qty  else 0 end);

    if v_deduct <> 0 then
      update public.stock_items
         set qty_on_hand = qty_on_hand - v_deduct
       where id = v_row.stock_item_id;

      insert into public.stock_movements (stock_item_id, delta, kind, lot_id, created_by)
      values (
        v_row.stock_item_id,
        -v_deduct,
        case when v_deduct > 0
             then 'lot_pick'::public.stock_move_kind
             else 'lot_return'::public.stock_move_kind
        end,
        p_lot_id,
        auth.uid()
      );
    end if;

    if v_target_qty > 0 then
      insert into public.lot_items (lot_id, stock_item_id, player_id, color, qty, applied)
      select p_lot_id,
             s.id,
             s.player_id,
             s.color,
             v_target_qty,
             v_target_applied
        from public.stock_items s
       where s.id = v_row.stock_item_id
      on conflict (lot_id, stock_item_id)
      do update set qty = excluded.qty, applied = excluded.applied;
    else
      delete from public.lot_items
       where lot_id = p_lot_id
         and stock_item_id = v_row.stock_item_id;
    end if;
  end loop;
end;
$$;


commit;
