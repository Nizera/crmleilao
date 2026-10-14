-- =============================================================================
-- 0010: Rate limiting para as telas públicas de autenticação
--
-- Sem isto, /painel/login e /painel/convite aceitam tentativas ilimitadas de
-- senha/OTP e permitem bombardear qualquer número de WhatsApp com SMS.
--
-- O contador vive no banco porque as server actions não compartilham memória
-- entre instâncias. A escrita é atômica (upsert + returning) para que duas
-- requisições simultâneas nunca fiquem ambas "dentro do limite".
-- =============================================================================

create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        integer not null default 0
);

alter table public.rate_limits enable row level security;

-- Sem policy: nem anon nem authenticated leem/escrevem. Só service_role,
-- que ignora RLS. A function chama o banco diretamente (security definer).
revoke all on public.rate_limits from public, anon, authenticated;

drop function if exists public.bump_rate_limit(text, integer, integer);

-- Retorna true enquanto a chamada atual ainda cabe no limite.
-- `p_window_seconds` define a janela deslizante (zera o contador ao vencer).
create function public.bump_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case
                  when rl.window_start < now() - make_interval(secs => p_window_seconds)
                    then 1
                  else rl.count + 1
                end,
        window_start = case
                         when rl.window_start < now() - make_interval(secs => p_window_seconds)
                           then now()
                         else rl.window_start
                       end
  returning rl.count into v_count;

  return coalesce(v_count, 1) <= p_limit;
end;
$$;

-- Só o servidor (service role) pode executar; a function já roda como definer
-- mas o execute fica explícito para anon/authenticated não chamarem.
revoke execute on function public.bump_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.bump_rate_limit(text, integer, integer)
  to service_role;
