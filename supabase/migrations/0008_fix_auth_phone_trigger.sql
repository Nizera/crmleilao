-- ===========================================================================
-- Corrige handle_new_auth_user: o GoTrue grava auth.users.phone SEM o "+".
-- Ex: criamos "+5511999998888", o Postgres recebe "5511999998888".
-- O trigger antigo comparava phone_e164 = new.phone e nunca achava o cliente,
-- aí caia no insert e violava customers_phone_e164_check (^\+[1-9]\d{10,14}$),
-- derrubando o createUser inteiro com "Database error creating new user".
-- ===========================================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
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

  begin
    insert into public.customers (phone_e164, auth_user_id)
    values (v_phone, new.id)
    on conflict (phone_e164) do nothing;
  exception when unique_violation then
    null;
  end;

  return new;
end;
$$;
