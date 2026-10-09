-- ===========================================================================
-- F2 — Estoque de figurinhas: jogadores, saldos, baixa por lote e ledger
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`.
--
-- Catálogo fixo: 20 jogadores x 4 cores = 80 SKUs.
-- Saldo PODE ficar negativo (decisão de operação): o admin vê o aviso na
-- tela e corrige depois pelo ajuste manual.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sticker_color') then
    create type sticker_color as enum ('roxa', 'bronze', 'prata', 'dourada');
  end if;

  if not exists (select 1 from pg_type where typname = 'stock_move_kind') then
    create type stock_move_kind as enum (
      'lot_pick',      -- saída: figurinha entrou num lote
      'lot_return',    -- entrada: lote cancelado, devolveu para a prateleira
      'manual_adjust'  -- entrada/saída manual, com nota do admin
    );
  end if;
end $$;

comment on type sticker_color is
  'Cor da figurinha. Não é a cor do time — é a versão da carta.';
comment on type stock_move_kind is
  'Motivo da movimentação. O ledger é append-only: nunca se atualiza nem se apaga.';

-- ---------------------------------------------------------------------------
-- players — catálogo fixo (semeado abaixo)
-- ---------------------------------------------------------------------------
create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  country    text not null,
  sort_order int  not null default 0
);

comment on table public.players is
  'Os 20 jogadores do catálogo. Fixo: sem CRUD na UI, seed na migração.';

create index if not exists players_sort_order_idx on public.players (sort_order, name);

-- ---------------------------------------------------------------------------
-- stock_items — saldo por (jogador, cor)
-- qty_on_hand pode ficar negativo de propósito.
-- ---------------------------------------------------------------------------
create table if not exists public.stock_items (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players (id) on delete cascade,
  color       sticker_color not null,
  qty_on_hand int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (player_id, color)
);

comment on table public.stock_items is
  'Um SKU: jogadora + cor. qty_on_hand = o que está na prateleira AGORA.';
comment on column public.stock_items.qty_on_hand is
  'Pode ficar negativo. Negativo = foi vendido mais do que existia; corrigir com ajuste manual.';

create index if not exists stock_items_player_idx on public.stock_items (player_id);

drop trigger if exists stock_items_set_updated_at on public.stock_items;
create trigger stock_items_set_updated_at
  before update on public.stock_items
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- lot_items — o que cada lote contém
-- `applied` = true quando o saldo já foi debitado (figurinha fora da prateleira).
-- Um lote cancelado mantém as linhas com applied = false, para poder repickar.
-- player_id/color são espelhados aqui de propósito: o cliente do painel lê o
-- próprio lote sem precisar de acesso a stock_items (que exporia o saldo).
-- ---------------------------------------------------------------------------
create table if not exists public.lot_items (
  lot_id        uuid not null references public.lots (id) on delete cascade,
  stock_item_id uuid not null references public.stock_items (id) on delete restrict,
  player_id     uuid not null references public.players (id),
  color         sticker_color not null,
  qty           int not null check (qty > 0),
  applied       boolean not null default false,
  primary key (lot_id, stock_item_id)
);

comment on table public.lot_items is
  'Composição de um lote. A baixa de estoque é feita pela RPC reconcile_lot_items.';

create index if not exists lot_items_lot_id_idx     on public.lot_items (lot_id);
create index if not exists lot_items_player_idx     on public.lot_items (player_id);
create index if not exists lot_items_stock_item_idx on public.lot_items (stock_item_id);

-- ---------------------------------------------------------------------------
-- stock_movements — ledger append-only
-- ---------------------------------------------------------------------------
create table if not exists public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  stock_item_id uuid not null references public.stock_items (id),
  delta         int  not null, -- positivo = entrou, negativo = saiu
  kind          stock_move_kind not null,
  lot_id        uuid references public.lots (id) on delete set null,
  note          text,
  created_by    uuid references public.admin_profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.stock_movements is
  'Ledger de estoque. Append-only, sem policy de update/delete.';

create index if not exists stock_movements_item_idx    on public.stock_movements (stock_item_id, created_at desc);
create index if not exists stock_movements_lot_idx     on public.stock_movements (lot_id);
create index if not exists stock_movements_created_idx on public.stock_movements (created_at desc);

-- ---------------------------------------------------------------------------
-- Seed: 20 jogadores x 4 cores
-- Saldos começam em 0 — o admin carrega pela tela de Estoque.
-- ---------------------------------------------------------------------------
insert into public.players (name, country, sort_order)
values
  ('Achraf Hakimi',      'Marrocos',        1),
  ('Alphonso Davies',    'Canadá',          2),
  ('Cody Gakpo',         'Holanda',         3),
  ('Christian Pulisic',  'Estados Unidos',  4),
  ('Cristiano Ronaldo',  'Portugal',        5),
  ('Erling Haaland',     'Noruega',         6),
  ('Federico Valverde',  'Uruguai',         7),
  ('Florian Wirtz',      'Alemanha',        8),
  ('Jérémy Doku',        'Bélgica',         9),
  ('Jude Bellingham',    'Inglaterra',     10),
  ('Kylian Mbappé',      'França',         11),
  ('Lamine Yamal',       'Espanha',        12),
  ('Lionel Messi',       'Argentina',      13),
  ('Luis Díaz',          'Colômbia',       14),
  ('Luka Modrić',        'Croácia',        15),
  ('Mohamed Salah',      'Egito',          16),
  ('Moisés Caicedo',     'Equador',        17),
  ('Raúl Jiménez',       'México',         18),
  ('Son Heung-min',      'Coreia do Sul',  19),
  ('Vinícius Júnior',    'Brasil',         20)
on conflict (name) do nothing;

insert into public.stock_items (player_id, color)
select p.id, c.color::sticker_color
from public.players p
cross join (values ('roxa'), ('bronze'), ('prata'), ('dourada')) as c (color)
on conflict (player_id, color) do nothing;

-- ---------------------------------------------------------------------------
-- RPC: reconcilia os itens de um lote e debita/devolve o saldo de uma vez
--
--   p_items  -> '[{"stock_item_id":"...","qty":2}, ...]'
--   p_apply  -> true  = figurinhas devem estar fora da prateleira
--               false = devolvidas (lote cancelado)
--
-- Calcula o diff entre o estado atual de lot_items e o desejado, trava as
-- linhas de estoque (for update), ajusta qty_on_hand e grava o ledger.
-- Saldo negativo é permitido.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_lot_items(
  p_lot_id uuid,
  p_items  jsonb,
  p_apply  boolean default true
)
returns void
language plpgsql
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
             then 'lot_pick'::stock_move_kind
             else 'lot_return'::stock_move_kind
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

-- ---------------------------------------------------------------------------
-- Seed explícito de saldo: usado pelo ajuste manual da tela de Estoque.
-- Devolve o saldo resultante para a UI atualizar sem refazer a query.
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_item_id uuid,
  p_qty     int,
  p_note    text default null
)
returns int
language plpgsql
as $$
declare
  v_new int;
begin
  if p_item_id is null then
    raise exception 'p_item_id é obrigatório';
  end if;

  if p_qty is null or p_qty = 0 then
    raise exception 'Quantidade não pode ser zero';
  end if;

  update public.stock_items
     set qty_on_hand = qty_on_hand + p_qty
   where id = p_item_id
  returning qty_on_hand into v_new;

  if not found then
    raise exception 'Item de estoque não encontrado';
  end if;

  insert into public.stock_movements (stock_item_id, delta, kind, note, created_by)
  values (p_item_id, p_qty, 'manual_adjust', nullif(btrim(p_note), ''), auth.uid());

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS — tudo é da equipe. O cliente não lê saldo nem ledger.
-- ---------------------------------------------------------------------------
alter table public.players         enable row level security;
alter table public.stock_items     enable row level security;
alter table public.lot_items       enable row level security;
alter table public.stock_movements enable row level security;

-- players: catálogo público do grupo (o painel mostra o que o cliente ganhou).
drop policy if exists players_select on public.players;
create policy players_select on public.players
  for select to authenticated
  using (true);

-- stock_items: só a equipe. Saldo não vaza para o cliente.
drop policy if exists stock_items_select_admin on public.stock_items;
create policy stock_items_select_admin on public.stock_items
  for select to authenticated
  using (public.is_admin());

drop policy if exists stock_items_update_admin on public.stock_items;
create policy stock_items_update_admin on public.stock_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- lot_items: a equipe lê tudo; o cliente lê os itens dos próprios lotes.
drop policy if exists lot_items_select on public.lot_items;
create policy lot_items_select on public.lot_items
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.lots l
      where l.id = lot_id and l.customer_id = public.current_customer_id()
    )
  );

drop policy if exists lot_items_insert_admin on public.lot_items;
create policy lot_items_insert_admin on public.lot_items
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists lot_items_update_admin on public.lot_items;
create policy lot_items_update_admin on public.lot_items
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists lot_items_delete_admin on public.lot_items;
create policy lot_items_delete_admin on public.lot_items
  for delete to authenticated
  using (public.is_admin());

-- stock_movements: append-only, só a equipe.
drop policy if exists stock_movements_select_admin on public.stock_movements;
create policy stock_movements_select_admin on public.stock_movements
  for select to authenticated
  using (public.is_admin());

drop policy if exists stock_movements_insert_admin on public.stock_movements;
create policy stock_movements_insert_admin on public.stock_movements
  for insert to authenticated
  with check (public.is_admin());
