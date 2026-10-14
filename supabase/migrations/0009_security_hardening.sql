-- ===========================================================================
-- 0009 — Hardening de segurança (auditoria)
-- Aplicar no SQL Editor do Supabase ou via `supabase db push`,
-- DEPOIS das migrações 0001..0008.
--
-- Corrige, nesta ordem de gravidade:
--   1. add_admin executável por anon/authenticated  → escalação a owner
--   2. is_admin() engloba 'viewer' nas policies de escrita → read-only escrevia
--   3. superfrete_webhook_secret legível por qualquer admin via app_settings
--   4. signup anônimo criava linha em customers para qualquer telefone
--   5. customers sem policy de DELETE (ação admin era negada em silêncio)
--   6. SECURITY DEFINER com search_path = public
--   7. índices faltando nas colunas filtradas
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. add_admin: só service_role (o bootstrap é feito no SQL Editor, que roda
--    como postgres e não depende de GRANT). O `revoke ... from public` da 0001
--    não basta: o PostgREST concede EXECUTE direto a anon e authenticated.
-- ---------------------------------------------------------------------------
revoke execute on function public.add_admin(text, admin_role, text)
  from public, anon, authenticated;
grant  execute on function public.add_admin(text, admin_role, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 2. Escrita exige owner/staff. Leitura continua sendo is_admin() (viewer
--    enxerga tudo, só não escreve). Vale também para as RPCs adjust_stock e
--    reconcile_lot_items: elas não são security definer, rodam como o chamador
--    e caem nas policies de UPDATE/INSERT abaixo.
-- ---------------------------------------------------------------------------
create or replace function public.has_staff_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles
    where id = auth.uid() and role in ('owner', 'staff')
  );
$$;

revoke execute on function public.has_staff_write() from public;
grant  execute on function public.has_staff_write() to anon, authenticated;

-- customers
drop policy if exists customers_insert_admin on public.customers;
create policy customers_insert_admin on public.customers
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists customers_update_self_or_admin on public.customers;
create policy customers_update_self_or_admin on public.customers
  for update to authenticated
  using (auth_user_id = auth.uid() or public.has_staff_write())
  with check (auth_user_id = auth.uid() or public.has_staff_write());

drop policy if exists customers_delete_admin on public.customers;
create policy customers_delete_admin on public.customers
  for delete to authenticated
  using (public.has_staff_write());

-- lots
drop policy if exists lots_insert_admin on public.lots;
create policy lots_insert_admin on public.lots
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists lots_update_admin on public.lots;
create policy lots_update_admin on public.lots
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

drop policy if exists lots_delete_admin on public.lots;
create policy lots_delete_admin on public.lots
  for delete to authenticated
  using (public.has_staff_write());

-- message_log
drop policy if exists message_log_insert_admin on public.message_log;
create policy message_log_insert_admin on public.message_log
  for insert to authenticated
  with check (public.has_staff_write());

-- storage (imagens de lote)
drop policy if exists "lot-images admin insert" on storage.objects;
create policy "lot-images admin insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lot-images' and public.has_staff_write());

drop policy if exists "lot-images admin update" on storage.objects;
create policy "lot-images admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'lot-images' and public.has_staff_write())
  with check (bucket_id = 'lot-images' and public.has_staff_write());

drop policy if exists "lot-images admin delete" on storage.objects;
create policy "lot-images admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lot-images' and public.has_staff_write());

-- estoque
drop policy if exists stock_items_update_admin on public.stock_items;
create policy stock_items_update_admin on public.stock_items
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

drop policy if exists lot_items_insert_admin on public.lot_items;
create policy lot_items_insert_admin on public.lot_items
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists lot_items_update_admin on public.lot_items;
create policy lot_items_update_admin on public.lot_items
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

drop policy if exists lot_items_delete_admin on public.lot_items;
create policy lot_items_delete_admin on public.lot_items
  for delete to authenticated
  using (public.has_staff_write());

drop policy if exists stock_movements_insert_admin on public.stock_movements;
create policy stock_movements_insert_admin on public.stock_movements
  for insert to authenticated
  with check (public.has_staff_write());

-- cobranças
drop policy if exists charges_insert_admin on public.charges;
create policy charges_insert_admin on public.charges
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists charges_update_admin on public.charges;
create policy charges_update_admin on public.charges
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

-- envios
drop policy if exists shipments_insert_admin on public.shipments;
create policy shipments_insert_admin on public.shipments
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists shipments_update_admin on public.shipments;
create policy shipments_update_admin on public.shipments
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

drop policy if exists shipments_delete_admin on public.shipments;
create policy shipments_delete_admin on public.shipments
  for delete to authenticated
  using (public.has_staff_write());

drop policy if exists shipment_lots_insert_admin on public.shipment_lots;
create policy shipment_lots_insert_admin on public.shipment_lots
  for insert to authenticated
  with check (public.has_staff_write());

drop policy if exists shipment_lots_update_admin on public.shipment_lots;
create policy shipment_lots_update_admin on public.shipment_lots
  for update to authenticated
  using (public.has_staff_write())
  with check (public.has_staff_write());

drop policy if exists shipment_lots_delete_admin on public.shipment_lots;
create policy shipment_lots_delete_admin on public.shipment_lots
  for delete to authenticated
  using (public.has_staff_write());

-- ---------------------------------------------------------------------------
-- 3. Segredos fora de app_settings. RLS é por linha, não por coluna: enquanto
--    o secret vive em app_settings, qualquer admin (inclusive viewer) lê a
--    linha inteira pelo client do browser e consegue forjar webhook.
--    app_secrets fica sem policy — só o service role acessa.
-- ---------------------------------------------------------------------------
create table if not exists public.app_secrets (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.app_secrets enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'app_settings'
      and column_name = 'superfrete_webhook_secret'
  ) then
    insert into public.app_secrets (key, value)
    select 'superfrete_webhook_secret', btrim(superfrete_webhook_secret)
    from public.app_settings
    where superfrete_webhook_secret is not null
      and btrim(superfrete_webhook_secret) <> ''
    on conflict (key) do nothing;

    alter table public.app_settings
      drop column superfrete_webhook_secret;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. O gatilho de auth só VINCULA um cliente já cadastrado; ele não cria
--    linha para qualquer telefone. Sem isso, um signup anônimo direto no
--    GoTrue (POST /auth/v1/otp com create_user) poluía o CRM e servia de
--    oracle de enumeração de telefones. Clientes passam a nascer só pela
--    ação admin (que já valida duplicidade) — o caminho de login continua
--    funcionando porque o cliente pré-existe.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_phone    text;
begin
  if new.phone is null then
    return new;
  end if;

  -- GoTrue omite o "+". Nosso schema exige E.164 completo.
  v_phone := case
    when new.phone like '+%' then new.phone
    else '+' || new.phone
  end;

  if v_phone !~ '^\+[1-9]\d{10,14}$' then
    return new;
  end if;

  select * into v_customer
  from public.customers
  where phone_e164 = v_phone
  for update;

  if found then
    if v_customer.auth_user_id is null then
      update public.customers
      set auth_user_id = new.id
      where id = v_customer.id;
    end if;
    return new;
  end if;

  -- Sem insert: telefone desconhecido não gera cliente.
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER com search_path vazio (anti search_path hijacking).
--    Os corpos já usam nomes qualificados (public./auth.).
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.admin_profiles where id = auth.uid()); $$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.admin_profiles
    where id = auth.uid() and role = 'owner'
  );
$$;

create or replace function public.add_admin(
  p_email text,
  p_role  admin_role default 'owner',
  p_name  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;

  if v_user_id is null then
    raise exception 'Nenhum usuário com o e-mail % — crie a conta no painel do Supabase (Authentication > Users) antes.', p_email;
  end if;

  insert into public.admin_profiles (id, name, role)
  values (v_user_id, p_name, p_role)
  on conflict (id) do update set name = excluded.name, role = excluded.role;

  return v_user_id;
end;
$$;

revoke execute on function public.add_admin(text, admin_role, text)
  from public, anon, authenticated;
grant  execute on function public.add_admin(text, admin_role, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Índices: as buscas do DAL filtram por essas colunas e hoje é seq scan.
--    (customers.name tinha trgm em coalesce(name,'') — o predicato é em name.)
-- ---------------------------------------------------------------------------
drop index if exists public.customers_name_trgm_idx;
create index if not exists customers_name_trgm_idx
  on public.customers using gin (name gin_trgm_ops);
create index if not exists customers_phone_trgm_idx
  on public.customers using gin (phone_e164 gin_trgm_ops);
create index if not exists lots_paid_at_idx
  on public.lots (paid_at desc);
create index if not exists stock_movements_kind_idx
  on public.stock_movements (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Claim de lote no envio: uma etiqueta por lote. Sem isso, duas chamadas
--    simultâneas a emitShipment liam a mesma elegibilidade e criavam DUAS
--    etiquetas (a carteira da SuperFrete era debitada duas vezes).
--
--    O `pg_advisory_xact_lock` serializa por lote dentro da transação do
--    INSERT: a segunda transação espera a primeira comitar e então enxerga a
--    linha já existente. A exclusão `status <> 'cancelled'` preserva o
--    reenvio após cancelamento (e mantém o histórico do envio cancelado).
-- ---------------------------------------------------------------------------
create or replace function public.assert_lot_free_for_shipment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.lot_id::text, 0));

  if exists (
    select 1
    from public.shipment_lots sl
    join public.shipments s on s.id = sl.shipment_id
    where sl.lot_id = new.lot_id
      and s.status <> 'cancelled'
  ) then
    raise exception 'Lote % já está vinculado a um envio ativo', new.lot_id;
  end if;

  return new;
end;
$$;

drop trigger if exists shipment_lots_claim_check on public.shipment_lots;
create trigger shipment_lots_claim_check
  before insert on public.shipment_lots
  for each row
  execute function public.assert_lot_free_for_shipment();

