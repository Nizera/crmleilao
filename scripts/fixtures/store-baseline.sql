-- Ambiente descartável que representa as tabelas usadas pela migration 0024.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_customer_id() returns uuid language sql stable as $$ select nullif(current_setting('test.customer',true),'')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.admin',true),'false') = 'true' $$;
create function public.has_staff_write() returns boolean language sql stable as $$ select public.is_admin() and coalesce(current_setting('test.readonly',true),'false') <> 'true' $$;
grant usage on schema public,auth to authenticated,service_role;
create table public.customers(id uuid primary key, name text, email text, cpf_cnpj text, phone_e164 text);
create table public.lots(id uuid primary key);
create table public.loyalty_settings(id boolean primary key, active boolean, points_per_real numeric, points_expire_days integer, ranking_enabled boolean, updated_by uuid, updated_at timestamptz);
create table public.loyalty_settings_history(id bigint generated always as identity, active boolean,points_per_real numeric,points_expire_days integer,ranking_enabled boolean,note text,changed_by uuid);
create table public.loyalty_rewards(id uuid primary key default gen_random_uuid(),name text not null,description text,points_cost integer check(points_cost>0),internal_cost numeric check(internal_cost>=0),created_by uuid references auth.users(id),stock integer check(stock>=0),active boolean default false,image_path text,created_at timestamptz default now(),updated_at timestamptz default now());
create table public.loyalty_redemptions(id uuid primary key,status text default 'pending');
create table public.loyalty_ledger(id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.customers(id),points numeric(12,2) not null check(points<>0),kind text not null check(kind in ('earned','spent','reversal','adjustment')),lot_id uuid,redemption_id uuid,note text,
check ((kind='earned' and points>0 and lot_id is not null and redemption_id is null)
or (kind='spent' and points<0 and redemption_id is not null and lot_id is null)
or (kind='reversal' and lot_id is not null and redemption_id is null)
or (kind='adjustment' and lot_id is null and redemption_id is null)));
create function public.validate_loyalty_reward() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger loyalty_rewards_validate before insert or update on public.loyalty_rewards for each row execute function public.validate_loyalty_reward();
create function public.request_loyalty_redemption(p_reward_id uuid) returns uuid language sql as $$ select null::uuid $$;
grant select on public.loyalty_rewards to authenticated;
alter table public.loyalty_rewards enable row level security;
create policy rewards_read on public.loyalty_rewards for select to authenticated using(active or public.is_admin());
insert into public.loyalty_settings(id,active,ranking_enabled) values(true,true,true);
