begin;
-- arremate_value permanece líquido: Pix, pontos, dashboard e declaração usam o total final.
alter table public.lots add column if not exists discount_amount numeric(12,2) not null default 0
 check(discount_amount>=0 and discount_amount<=999999999.99);
comment on column public.lots.discount_amount is 'Desconto em reais. Preço original = arremate_value + discount_amount.';
commit;
notify pgrst, 'reload schema';
