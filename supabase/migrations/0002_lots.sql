-- ===========================================================================
-- F1 — Lotes, arremates, log de mensagens e imagens
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enum de status do lote
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'lot_status') then
    create type lot_status as enum (
      'pending_payment', -- arrematado, aguardando Pix
      'paid',            -- pagamento confirmado
      'shipped',         -- postado nos Correios
      'delivered',       -- entregue
      'cancelled'        -- desistência / estorno
    );
  end if;
end $$;

comment on type lot_status is
  'Ciclo de vida do arremate. Usar cancelled em vez de apagar o registro.';

-- ---------------------------------------------------------------------------
-- Próxima terça estritamente posterior à data informada.
--   leilão 06 (ter) -> envio 13     leilão 11 (dom) -> envio 13
--   leilão 07 (qua) -> envio 13     leilão 12 (seg) -> envio 13
-- ---------------------------------------------------------------------------
create or replace function public.next_shipping_date(p_date date)
returns date
language sql
immutable
as $$
  select p_date + case
    when (2 - extract(dow from p_date)::int + 7) % 7 = 0 then 7
    else (2 - extract(dow from p_date)::int + 7) % 7
  end;
$$;

comment on function public.next_shipping_date(date) is
  'Data de envio padrão: a terça seguinte, sempre posterior à data do lote.';

-- ---------------------------------------------------------------------------
-- lots — um registro por arremate
-- ---------------------------------------------------------------------------
create table if not exists public.lots (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique
                 default upper(encode(gen_random_bytes(4), 'hex')),
  customer_id    uuid not null references public.customers (id)
                 on delete restrict,
  title          text not null check (char_length(title) between 1 and 160),
  description    text,
  -- Caminhos no bucket `lot-images`. A URL é montada na aplicação.
  images         text[] not null default '{}',
  arremate_value numeric(10,2) not null check (arremate_value >= 0),
  status         lot_status not null default 'pending_payment',
  auction_date   date not null default current_date,
  shipping_date  date,
  paid_at        timestamptz,
  shipped_at     timestamptz,
  notes          text,
  created_by     uuid references public.admin_profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.lots is
  'Um lote arrematado no grupo. O lance do grupo é fixo de R$5; aqui só se grava o valor final.';
comment on column public.lots.code is
  'Código curto usado no link público /painel/lotes/<code>.';
comment on column public.lots.images is
  'Caminhos de objeto em storage (bucket lot-images), não URLs.';
comment on column public.lots.auction_date is
  'Data em que o lote foi leiloado. Define o envio padrão (terça seguinte).';

create index if not exists lots_customer_id_idx    on public.lots (customer_id);
create index if not exists lots_status_idx         on public.lots (status);
create index if not exists lots_auction_date_idx   on public.lots (auction_date desc, created_at desc);
create index if not exists lots_shipping_date_idx  on public.lots (shipping_date);

-- Data de envio: terça seguinte quando o admin não informar.
create or replace function public.lots_fill_shipping_date()
returns trigger
language plpgsql
as $$
begin
  if new.shipping_date is null then
    new.shipping_date := public.next_shipping_date(new.auction_date);
  end if;
  return new;
end;
$$;

drop trigger if exists lots_fill_shipping_date on public.lots;
create trigger lots_fill_shipping_date
  before insert on public.lots
  for each row execute function public.lots_fill_shipping_date();

drop trigger if exists lots_set_updated_at on public.lots;
create trigger lots_set_updated_at
  before update on public.lots
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- message_log — registro do que foi aberto no WhatsApp
-- O disparo é manual (link wa.me), então guardamos o texto e o link gerados.
-- ---------------------------------------------------------------------------
create table if not exists public.message_log (
  id          uuid primary key default gen_random_uuid(),
  lot_id      uuid references public.lots (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  channel     text not null default 'whatsapp',
  kind        text not null,
  text_body   text not null,
  link        text,
  sent_by     uuid references public.admin_profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on column public.message_log.kind is
  'Categoria: auction_notice | payment_request | shipping_notice | custom.';
comment on column public.message_log.link is
  'URL wa.me aberta pelo admin. Sempre que houver link, a mensagem foi levada ao usuário.';

create index if not exists message_log_lot_id_idx     on public.message_log (lot_id);
create index if not exists message_log_customer_id_idx on public.message_log (customer_id);
create index if not exists message_log_created_at_idx on public.message_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Bucket de imagens dos lotes
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lot-images',
  'lot-images',
  true,
  5242880, -- 5 MB
  array['image/jpeg','image/png','image/webp','image/avif']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.lots         enable row level security;
alter table public.message_log  enable row level security;

-- lots: a equipe lê tudo; o cliente lê os próprios.
drop policy if exists lots_select on public.lots;
create policy lots_select on public.lots
  for select to authenticated
  using (public.is_admin() or customer_id = public.current_customer_id());

drop policy if exists lots_insert_admin on public.lots;
create policy lots_insert_admin on public.lots
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists lots_update_admin on public.lots;
create policy lots_update_admin on public.lots
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists lots_delete_admin on public.lots;
create policy lots_delete_admin on public.lots
  for delete to authenticated
  using (public.is_admin());

-- message_log: só a equipe.
drop policy if exists message_log_select_admin on public.message_log;
create policy message_log_select_admin on public.message_log
  for select to authenticated
  using (public.is_admin());

drop policy if exists message_log_insert_admin on public.message_log;
create policy message_log_insert_admin on public.message_log
  for insert to authenticated
  with check (public.is_admin());

-- storage.objects: leitura pública das imagens de lote.
drop policy if exists "lot-images public read" on storage.objects;
create policy "lot-images public read" on storage.objects
  for select
  using (bucket_id = 'lot-images');

drop policy if exists "lot-images admin insert" on storage.objects;
create policy "lot-images admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lot-images' and public.is_admin());

drop policy if exists "lot-images admin update" on storage.objects;
create policy "lot-images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'lot-images' and public.is_admin())
  with check (bucket_id = 'lot-images' and public.is_admin());

drop policy if exists "lot-images admin delete" on storage.objects;
create policy "lot-images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lot-images' and public.is_admin());
