-- Só novos lotes avisados ficam sujeitos ao prazo automático.
-- Não cancela lotes, não altera valores, estoque ou pagamentos.
begin;
create or replace function public.set_lot_payment_deadline() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' and new.status='pending_payment' and new.arremate_value>0 then new.payment_due_at:=coalesce(new.created_at,now())+interval '24 hours';end if;
 if tg_op='UPDATE' then
  if new.status in('paid','shipped','delivered') and new.status is distinct from old.status then new.payment_expired_at:=null;end if;
  if old.status<>'pending_payment' and new.status='pending_payment' and new.arremate_value>0 and old.payment_due_at is not null then
   new.payment_due_at:=now()+interval '24 hours';new.payment_expired_at:=null;new.payment_reminded_at:=null;new.payment_last_warning_at:=null;new.payment_expiry_retry_at:=null;
  end if;
  if new.charge_id is distinct from old.charge_id and new.charge_id is not null and new.status='pending_payment' and new.payment_due_at<=now() then raise exception 'O prazo de pagamento deste lote encerrou. Atualize o painel.';end if;
 end if;
 return new;
end $$;

-- Retira apenas a tolerância retroativa atribuída pela 0062.
-- Um prazo originalmente criado com o lote (cadastro +24h) é preservado.
update public.lots set payment_due_at=null,payment_expiry_retry_at=null
where status='pending_payment' and paid_at is null and payment_expired_at is null
and payment_due_at>created_at+interval '24 hours 1 second';
commit;
