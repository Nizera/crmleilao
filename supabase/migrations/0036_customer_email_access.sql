-- Cadastro por e-mail: aplicar antes de ativar CUSTOMER_EMAIL_ACCESS_ENABLED.
-- Nunca mescla clientes automaticamente. Duplicatas antigas precisam de revisão.
begin;
do $$ begin
 if exists(select 1 from public.customers where nullif(btrim(email),'') is not null
 group by lower(btrim(email)) having count(*)>1) then
  raise exception 'Há e-mails duplicados em customers. Revise-os antes de aplicar 0036; nenhum cadastro foi alterado.';
 end if;
end $$;
create unique index if not exists customers_email_normalized_unique
 on public.customers(lower(btrim(email))) where nullif(btrim(email),'') is not null;

-- Prova da verificação de OTP de E-MAIL, gravada só pela ação de servidor.
-- AMR=otp sozinho também pode significar SMS; isso não comprova posse do e-mail.
create table if not exists public.customer_email_proofs (
 auth_user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null,
 verified_at timestamptz not null default now()
);
alter table public.customer_email_proofs enable row level security;
revoke all on public.customer_email_proofs from public,anon,authenticated;
grant all on public.customer_email_proofs to service_role;

-- Consulta exata, sem curingas e restrita ao servidor. Não expõe clientes no endpoint público.
create or replace function public.customer_email_access_target(p_email text)
returns table(customer_id uuid, auth_user_id uuid, phone_e164 text)
language sql stable security definer set search_path=public,pg_temp as $$
 select c.id,c.auth_user_id,c.phone_e164 from public.customers c
 where lower(btrim(c.email))=lower(btrim(p_email));
$$;
revoke all on function public.customer_email_access_target(text) from public,anon,authenticated;
grant execute on function public.customer_email_access_target(text) to service_role;

-- Só aceita identidade verificada pelo Supabase; não confia em metadata/JWT do navegador.
create or replace function public.complete_customer_email_access(p_name text,p_phone text)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user auth.users%rowtype; v_customer public.customers%rowtype; v_id uuid;
begin
 select * into v_user from auth.users where id=auth.uid();
 if v_user.id is null or v_user.email_confirmed_at is null or nullif(btrim(v_user.email),'') is null then
  raise exception 'EMAIL_NOT_VERIFIED';
 end if;
 -- Também exige prova recente de OTP no JWT assinado. Protege mesmo se alguém
 -- desativar Confirm Email no Supabase e tentar signUp direto com senha.
 if not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) m
   where m->>'method'='otp' and (m->>'timestamp')::numeric > extract(epoch from now())-900)
 then raise exception 'EMAIL_OTP_REQUIRED'; end if;
 if not exists(select 1 from public.customer_email_proofs p where p.auth_user_id=v_user.id
   and p.email=lower(btrim(v_user.email)) and p.verified_at > now()-interval '15 minutes')
 then raise exception 'EMAIL_OTP_REQUIRED'; end if;
 if exists(select 1 from public.admin_profiles where id=v_user.id) then raise exception 'ACCOUNT_CONFLICT'; end if;
 -- Serializa dois cadastros simultâneos do mesmo e-mail, inclusive quando ainda não existe cliente.
 perform pg_advisory_xact_lock(hashtextextended(lower(btrim(v_user.email)),0));
 select * into v_customer from public.customers where auth_user_id=v_user.id for update;
 if found then
  if lower(btrim(v_customer.email)) is distinct from lower(btrim(v_user.email)) then raise exception 'ACCOUNT_CONFLICT'; end if;
  update public.customer_invites set used_at=now() where customer_id=v_customer.id and used_at is null;
  return v_customer.id;
 end if;
 select * into v_customer from public.customers where lower(btrim(email))=lower(btrim(v_user.email)) for update;
 if found then
  if v_customer.auth_user_id is not null then raise exception 'ACCOUNT_CONFLICT'; end if;
  update public.customers set auth_user_id=v_user.id where id=v_customer.id;
  -- Invalida links antigos que poderiam redefinir a senha após a ativação por e-mail.
  update public.customer_invites set used_at=now() where customer_id=v_customer.id and used_at is null;
  return v_customer.id;
 end if;
 if p_name is null or p_phone is null or length(btrim(p_name)) not between 2 and 120 or p_phone !~ '^\+[1-9][0-9]{10,14}$' then raise exception 'INVALID_PROFILE'; end if;
 -- Telefone informado não é prova de posse: jamais atribui lotes de outro cadastro.
 if exists(select 1 from public.customers where phone_e164=p_phone) then raise exception 'ACCOUNT_CONFLICT'; end if;
 insert into public.customers(name,phone_e164,email,auth_user_id)
 values(btrim(p_name),p_phone,lower(btrim(v_user.email)),v_user.id) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.complete_customer_email_access(text,text) from public,anon;
grant execute on function public.complete_customer_email_access(text,text) to authenticated;
commit;
