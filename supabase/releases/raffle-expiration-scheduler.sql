-- Executar DEPOIS do deploy e de cadastrar no Vault o segredo:
-- Nome: ocdl_raffle_cron_secret
-- Valor: o mesmo CRON_SECRET da Vercel (não enviar em chat nem versionar).
-- Exige pg_cron e pg_net habilitados nas extensões do Supabase.
begin;
do $setup$
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') then
  raise exception 'Habilite pg_cron e pg_net no Supabase antes de agendar.';
 end if;
 if not exists(select 1 from vault.decrypted_secrets where name='ocdl_raffle_cron_secret' and length(decrypted_secret)>20) then
  raise exception 'Cadastre no Vault o segredo ocdl_raffle_cron_secret com o CRON_SECRET da Vercel.';
 end if;
end;
$setup$;
-- Os papéis do aplicativo não devem ler cabeçalhos dos pedidos HTTP da fila.
revoke all on table net.http_request_queue,net._http_response from public,anon,authenticated;
select cron.schedule('ocdl-raffle-expiration','* * * * *', $job$
 select net.http_get(
  url := 'https://www.oscarasdaslegends.com.br/api/cron/raffle-expiration',
  headers := jsonb_build_object('Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='ocdl_raffle_cron_secret' limit 1)),
  timeout_milliseconds := 55000
 ) where exists(select 1 from public.raffle_orders where status in ('creating','pending') and reservation_expires_at<=now());
$job$);
commit;
