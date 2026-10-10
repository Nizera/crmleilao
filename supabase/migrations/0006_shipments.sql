-- ===========================================================================
-- F4 — Envios: pacotes SuperFrete (cotação, etiqueta, rastreio)
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`,
-- DEPOIS das migrações 0001…0005.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enum de status do envio (espelha os status da etiqueta SuperFrete)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'shipment_status') then
    create type shipment_status as enum (
      'pending',   -- etiqueta criada, aguardando pagamento (saldo da carteira)
      'released',  -- etiqueta paga, aguardando postagem (rastreio disponível)
      'posted',    -- postado pela transportadora
      'delivered', -- entregue ao destinatário
      'cancelled'  -- cancelado (valor estornado à carteira SuperFrete)
    );
  end if;
end $$;

comment on type shipment_status is
  'Ciclo do envio SuperFrete. Os status vêm do webhook e podem ser ressincronizados pela API.';

-- ---------------------------------------------------------------------------
-- shipments — um pacote por cliente (lotes agrupados)
-- ---------------------------------------------------------------------------
create table if not exists public.shipments (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique
                  default 'E' || upper(encode(gen_random_bytes(4), 'hex')),
  customer_id     uuid not null references public.customers (id)
                  on delete restrict,
  batch_date      date not null default public.next_shipping_date(current_date),
  status          shipment_status not null default 'pending',
  service_id      smallint
                  check (service_id is null or service_id in (1, 2, 3, 17, 31, 33)),
  service_name    text,
  carrier         text,
  price           numeric(10,2),
  discount        numeric(10,2),
  delivery_time   smallint,
  insurance_value numeric(10,2),
  -- Mesmas dimensões usadas no cálculo e na etiqueta (cm / kg).
  volume          jsonb not null,
  -- Snapshot do destinatário no momento da emissão (o endereço pode mudar).
  address         jsonb not null,
  -- Id da etiqueta na SuperFrete (retornado por POST /api/v0/cart).
  sf_order_id     text not null unique,
  tracking_code   text,
  tracking_url    text,
  label_print_url text,
  paid_at         timestamptz,
  posted_at       timestamptz,
  delivered_at    timestamptz,
  cancelled_at    timestamptz,
  -- Histórico de eventos do webhook (depuração): [{event, received_at, ...}].
  events          jsonb not null default '[]',
  notes           text,
  created_by      uuid references public.admin_profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.shipments is
  'Pacote emitido na SuperFrete agrupando lotes pagos de um cliente.';
comment on column public.shipments.batch_date is
  'Data da terça do envio. Padrão: próxima terça (next_shipping_date).';
comment on column public.shipments.volume is
  'Dimensões do pacote em cm/kg usadas no cálculo e na etiqueta.';
comment on column public.shipments.address is
  'Snapshot do destinatário (nome, endereço, CPF, e-mail, telefone) na emissão.';
comment on column public.shipments.events is
  'Eventos recebidos do webhook SuperFrete, para auditoria.';

create index if not exists shipments_customer_id_idx on public.shipments (customer_id);
create index if not exists shipments_batch_date_idx  on public.shipments (batch_date desc, created_at desc);
create index if not exists shipments_status_idx      on public.shipments (status);

drop trigger if exists shipments_set_updated_at on public.shipments;
create trigger shipments_set_updated_at
  before update on public.shipments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- shipment_lots — quais lotes entram em cada pacote
-- Um lote só pode estar em um envio ativo (regra aplicada na aplicação).
-- ---------------------------------------------------------------------------
create table if not exists public.shipment_lots (
  shipment_id uuid not null references public.shipments (id) on delete cascade,
  lot_id      uuid not null references public.lots (id) on delete restrict,
  primary key (shipment_id, lot_id)
);

create index if not exists shipment_lots_lot_id_idx on public.shipment_lots (lot_id);

comment on table public.shipment_lots is
  'Vínculo N:N entre envios e lotes pagos.';

-- ---------------------------------------------------------------------------
-- app_settings — endereço de origem dos envios + segredo do webhook
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists origin_name  text
    check (origin_name is null or char_length(origin_name) between 1 and 50),
  add column if not exists origin_address text
    check (origin_address is null or char_length(origin_address) between 1 and 50),
  add column if not exists origin_number text
    check (origin_number is null or char_length(origin_number) <= 10),
  add column if not exists origin_district text
    check (origin_district is null or char_length(origin_district) between 1 and 60),
  add column if not exists origin_city  text
    check (origin_city is null or char_length(origin_city) between 1 and 50),
  add column if not exists origin_state text
    check (origin_state is null or origin_state ~ '^[A-Z]{2}$'),
  add column if not exists origin_cep  text
    check (origin_cep is null or origin_cep ~ '^[0-9]{8}$'),
  add column if not exists superfrete_webhook_secret text;

comment on column public.app_settings.origin_cep is
  'CEP de origem dos envios, só dígitos (8). Obrigatório para emitir etiquetas.';
comment on column public.app_settings.superfrete_webhook_secret is
  'secret_token devolvido ao cadastrar o webhook SuperFrete (valida X-ME-Signature).';

-- ---------------------------------------------------------------------------
-- RLS — equipe lê e escreve; cliente enxerga os próprios envios.
-- ---------------------------------------------------------------------------
alter table public.shipments      enable row level security;
alter table public.shipment_lots  enable row level security;

drop policy if exists shipments_select on public.shipments;
create policy shipments_select on public.shipments
  for select to authenticated
  using (public.is_admin() or customer_id = public.current_customer_id());

drop policy if exists shipments_insert_admin on public.shipments;
create policy shipments_insert_admin on public.shipments
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists shipments_update_admin on public.shipments;
create policy shipments_update_admin on public.shipments
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists shipments_delete_admin on public.shipments;
create policy shipments_delete_admin on public.shipments
  for delete to authenticated
  using (public.is_admin());

drop policy if exists shipment_lots_select on public.shipment_lots;
create policy shipment_lots_select on public.shipment_lots
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.shipments s
      where s.id = shipment_id and s.customer_id = public.current_customer_id()
    )
  );

drop policy if exists shipment_lots_insert_admin on public.shipment_lots;
create policy shipment_lots_insert_admin on public.shipment_lots
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists shipment_lots_update_admin on public.shipment_lots;
create policy shipment_lots_update_admin on public.shipment_lots
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists shipment_lots_delete_admin on public.shipment_lots;
create policy shipment_lots_delete_admin on public.shipment_lots
  for delete to authenticated
  using (public.is_admin());
