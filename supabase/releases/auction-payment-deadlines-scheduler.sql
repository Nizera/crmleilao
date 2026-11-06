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
-- A fila HTTP recebe somente uma assinatura válida por até 90 segundos.
-- O segredo permanente fica no Vault, sem ser copiado para os cabeçalhos.
select cron.schedule('ocdl-auction-payment-deadlines','* * * * *', $job$
 select net.http_get(
  url := 'https://www.oscarasdaslegends.com.br/api/cron/auction-expiration',
  headers := jsonb_build_object(
   'x-auction-cron-time',floor(extract(epoch from now()))::bigint::text,
   'Authorization','Bearer '||encode(extensions.hmac(
    'auction-expiration:'||floor(extract(epoch from now()))::bigint::text,
    (select decrypted_secret from vault.decrypted_secrets where name='ocdl_raffle_cron_secret' limit 1),
    'sha256'),'hex')),
  timeout_milliseconds := 55000
 ) where exists(select 1 from public.lots where status='pending_payment' and arremate_value>0 and payment_due_at is not null and ((payment_due_at<=now() and (payment_expiry_retry_at is null or payment_expiry_retry_at<=now())) or (payment_due_at>now() and ((payment_due_at<=now()+interval '12 hours' and payment_reminded_at is null) or (payment_due_at<=now()+interval '2 hours' and payment_last_warning_at is null)))));
$job$);
commit;
