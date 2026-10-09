-- ===========================================================================
-- F5 — Configuração: parâmetros do leilão, modelos de mensagem e endereço
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`,
-- DEPOIS das migrações 0001, 0002 e 0003.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- app_settings — linha única com os parâmetros globais do sistema
--   id = true (constraint impede uma segunda linha).
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                  boolean primary key default true,
  bid_increment       numeric(6,2) not null default 5
                      check (bid_increment > 0),
  shipping_weekday    smallint not null default 2
                      check (shipping_weekday between 0 and 6),
  wa_notice_template  text not null default
    $msg$Lote {code} — {title}
Arremate: {value}
Envio: {shipping}

Acompanhe no seu painel: {link}$msg$,
  wa_payment_template text not null default
    $msg$Olá {name}! O lote {code} está aguardando pagamento.
Valor: {value}
Pague pelo Pix: {link}$msg$,
  wa_shipping_template text not null default
    $msg$Olá {name}! O lote {code} foi enviado.
Rastreio: {tracking}$msg$,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint app_settings_single_row check (id)
);

comment on table public.app_settings is
  'Parâmetros globais editáveis na tela de Configuração. Sempre uma linha.';
comment on column public.app_settings.bid_increment is
  'Incremento do lance do leilão em reais (o grupo começa em 5).';
comment on column public.app_settings.shipping_weekday is
  'Dia da semana do envio (0=domingo … 6=sábado). Data padrão do lote = a seguinte.';
comment on column public.app_settings.wa_notice_template is
  'Modelo do aviso de arremate. Placeholders: {code} {title} {value} {shipping} {link}.';
comment on column public.app_settings.wa_payment_template is
  'Modelo do pedido de pagamento (F3). Placeholders: {name} {code} {value} {link}.';
comment on column public.app_settings.wa_shipping_template is
  'Modelo do aviso de envio (F4). Placeholders: {name} {code} {tracking}.';

-- Linha única com os valores padrão (idênticos aos do app).
insert into public.app_settings (
  id, bid_increment, shipping_weekday,
  wa_notice_template, wa_payment_template, wa_shipping_template
)
values (
  true, 5, 2,
  $msg$Lote {code} — {title}
Arremate: {value}
Envio: {shipping}

Acompanhe no seu painel: {link}$msg$,
  $msg$Olá {name}! O lote {code} está aguardando pagamento.
Valor: {value}
Pague pelo Pix: {link}$msg$,
  $msg$Olá {name}! O lote {code} foi enviado.
Rastreio: {tracking}$msg$
)
on conflict (id) do nothing;

drop trigger if exists app_settings_set_updated_at on public.app_settings;
create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- customers — endereço completo para o envio (preenchido no primeiro login)
-- Armazenados só com dígitos no CEP (12345678) e UF maiúscula (SP).
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists address_cep text
    check (address_cep is null or address_cep ~ '^[0-9]{8}$'),
  add column if not exists address_street text
    check (address_street is null or char_length(address_street) between 1 and 160),
  add column if not exists address_number text
    check (address_number is null or char_length(address_number) between 1 and 20),
  add column if not exists address_complement text
    check (address_complement is null or char_length(address_complement) <= 80),
  add column if not exists address_district text
    check (address_district is null or char_length(address_district) between 1 and 80),
  add column if not exists address_city text
    check (address_city is null or char_length(address_city) between 1 and 80),
  add column if not exists address_state text
    check (address_state is null or address_state ~ '^[A-Z]{2}$');

comment on column public.customers.address_cep is
  'CEP só com dígitos (ex: 01310100). Preenchido no primeiro login do cliente.';
comment on column public.customers.address_state is 'UF em 2 letras maiúsculas.';

-- ---------------------------------------------------------------------------
-- next_shipping_date — passa a respeitar o dia configurado em app_settings.
-- De immutable (0002) para stable: lê uma tabela.
-- ---------------------------------------------------------------------------
create or replace function public.next_shipping_date(p_date date)
returns date
language sql
stable
as $$
  select p_date + case
    when (w - extract(dow from p_date)::int + 7) % 7 = 0 then 7
    else (w - extract(dow from p_date)::int + 7) % 7
  end
  from (
    select coalesce(
      (select shipping_weekday from public.app_settings where id = true),
      2
    )::int as w
  ) settings;
$$;

comment on function public.next_shipping_date(date) is
  'Próxima data de envio: o dia configurado em app_settings.shipping_weekday, sempre posterior à data do lote.';

-- ---------------------------------------------------------------------------
-- RLS — equipe lê; só o dono altera. Sem insert/delete para clientes:
-- a linha nasce na migração e só o service role recriaria.
-- ---------------------------------------------------------------------------
alter table public.app_settings enable row level security;

drop policy if exists app_settings_select_admin on public.app_settings;
create policy app_settings_select_admin on public.app_settings
  for select to authenticated
  using (public.is_admin());

drop policy if exists app_settings_update_owner on public.app_settings;
create policy app_settings_update_owner on public.app_settings
  for update to authenticated
  using (public.is_owner())
  with check (public.is_owner());
