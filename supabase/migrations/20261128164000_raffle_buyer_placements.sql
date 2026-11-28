begin;

-- Existing prizes, results and vouchers retain their first-place identity.
alter table public.auction_vouchers drop constraint auction_vouchers_campaign_id_fkey,
  drop constraint auction_vouchers_campaign_id_key;
alter table public.raffle_buyer_results drop constraint raffle_buyer_results_campaign_id_fkey;
alter table public.raffle_buyer_bonus drop constraint raffle_buyer_bonus_pkey,
  add column placement integer not null default 1 check (placement between 1 and 3),
  add primary key (campaign_id, placement);
alter table public.raffle_buyer_results drop constraint raffle_buyer_results_pkey,
  add column placement integer not null default 1 check (placement between 1 and 3),
  add primary key (campaign_id, placement),
  add unique (campaign_id, customer_id),
  add foreign key (campaign_id, placement) references public.raffle_buyer_bonus(campaign_id, placement);
alter table public.auction_vouchers
  add column placement integer not null default 1 check (placement between 1 and 3),
  add unique (campaign_id, placement),
  add foreign key (campaign_id, placement) references public.raffle_buyer_results(campaign_id, placement);

create or replace function public.set_raffle_buyer_placement(p_campaign uuid, p_title text, p_kind text, p_amount numeric, p_expected integer, p_placement integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.raffle_campaigns%rowtype; b public.raffle_buyer_bonus%rowtype;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found or c.archived_at is not null or c.status not in ('draft','paused','open') then raise exception 'O bônus só pode ser editado antes do encerramento da campanha.';end if;
 if exists(select 1 from public.raffle_buyer_results where campaign_id=c.id) then raise exception 'O bônus já foi apurado. O prêmio conquistado não pode ser alterado.';end if;
 if p_placement is null or p_placement not between 1 and 3 then raise exception 'Colocação inválida.';end if;
 if p_placement>1 and not exists(select 1 from public.raffle_buyer_bonus where campaign_id=c.id and placement=p_placement-1)
 then raise exception 'Configure primeiro o prêmio da posição anterior.';end if;
 select * into b from public.raffle_buyer_bonus where campaign_id=c.id and placement=p_placement;
 if coalesce(b.version,0) is distinct from p_expected then raise exception 'O bônus mudou. Atualize a página.';end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 120 or p_kind is null or p_kind not in ('physical','pix','voucher','physical_pix')
  or (p_kind<>'physical' and (p_amount is null or p_amount<=0 or p_amount>100000)) then raise exception 'Confira o prêmio e o valor.';end if;
 insert into public.raffle_buyer_bonus(campaign_id,placement,title,delivery_kind,amount) values(c.id,p_placement,btrim(p_title),p_kind,case when p_kind='physical' then null else round(p_amount,2) end)
 on conflict(campaign_id,placement) do update set title=excluded.title,delivery_kind=excluded.delivery_kind,amount=excluded.amount,version=raffle_buyer_bonus.version+1;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),
  'Bônus do '||p_placement||'º maior comprador atualizado. Antes: '||coalesce(jsonb_build_object('title',b.title,'kind',b.delivery_kind,'amount',b.amount,'version',b.version)::text,'null')||
  '. Depois: '||jsonb_build_object('title',btrim(p_title),'kind',p_kind,'amount',case when p_kind='physical' then null else round(p_amount,2) end,'version',coalesce(b.version,0)+1)::text||
  '. Reservas e pagamentos preservados; apuração no encerramento.');
end;$function$;

revoke all on function public.set_raffle_buyer_placement(uuid,text,text,numeric,integer,integer) from public,anon;
grant execute on function public.set_raffle_buyer_placement(uuid,text,text,numeric,integer,integer) to authenticated;
create or replace function public.set_raffle_buyer_bonus(p_campaign uuid,p_title text,p_kind text,p_amount numeric,p_expected integer)
returns void language sql set search_path='' as $$
 select public.set_raffle_buyer_placement(p_campaign,p_title,p_kind,p_amount,p_expected,1);
$$;

create or replace function public.finalize_raffle_buyer_bonus(p_campaign uuid, p_historical_fulfilled boolean DEFAULT false, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.raffle_campaigns%rowtype;b public.raffle_buyer_bonus%rowtype;w record;ties integer;pid uuid;oid uuid;num integer;snap jsonb;
begin
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not exists(select 1 from public.raffle_buyer_bonus where campaign_id=p_campaign) then return;end if;
 if c.status<>'closed' then raise exception 'Encerre a campanha antes de apurar o bônus.';end if;
 if exists(select 1 from public.raffle_buyer_results where campaign_id=c.id) then return;end if;
 if exists(select 1 from public.raffle_orders where campaign_id=c.id and status in ('creating','pending','review')) then raise exception 'Resolva as reservas pendentes antes de apurar o maior comprador.';end if;
 if p_note is not null and exists(select 1 from public.raffle_buyer_bonus where campaign_id=c.id and placement>1)
 then raise exception 'A conferência histórica está disponível para campanhas com um único prêmio.';end if;
 for b in select * from public.raffle_buyer_bonus where campaign_id=c.id order by placement loop
  pid:=null;
  select * into w from public.raffle_buyer_totals(c.id) order by quantity desc,reached_at asc nulls last,customer_id limit 1 offset (b.placement-1);
  if not found then
   if b.placement=1 then raise exception 'Não há compras pagas para apurar o bônus.';end if;
   exit;
  end if;
  if exists(select 1 from public.raffle_buyer_totals(c.id) where quantity=w.quantity and missing_time) then raise exception 'Confira as datas de confirmação de pagamento antes de apurar o maior comprador.';end if;
  select count(*) into ties from public.raffle_buyer_totals(c.id) where quantity=w.quantity and reached_at=w.reached_at;
  if ties>1 then raise exception 'Empate exato entre maiores compradores. Confira o regulamento antes de encerrar.';end if;
  select jsonb_agg(jsonb_build_object('order',id,'quantity',cardinality(numbers),'paid_at',paid_at,'amount',amount) order by paid_at,id)
  into snap from public.raffle_orders where campaign_id=c.id and customer_id=w.customer_id and status='paid';
  if b.delivery_kind in('physical','physical_pix') and not p_historical_fulfilled then
   insert into public.raffle_prizes(campaign_id,title,kind) values(c.id,left(b.placement||'º maior comprador · '||b.title,160),'buyer') returning id into pid;
   select id,numbers[1] into oid,num from public.raffle_orders where campaign_id=c.id and customer_id=w.customer_id and status='paid' order by paid_at desc,id limit 1;
   perform public.materialize_raffle_award(pid,oid,num,'Maior comprador: '||w.quantity||' cotas pagas; total atingido em '||w.reached_at,null);
   update public.logistics_pending set reason=b.placement||'º maior comprador da rifa: '||c.title||' · '||w.quantity||' cotas pagas' where id=(select logistics_id from public.raffle_awards where prize_id=pid);
  end if;
  insert into public.raffle_buyer_results(campaign_id,placement,customer_id,quantity,reached_at,title,delivery_kind,amount,prize_id,snapshot,status,fulfilled_at,fulfilled_by,fulfillment_note,pix_paid_at,pix_payment_note)
  values(c.id,b.placement,w.customer_id,w.quantity,w.reached_at,b.title,b.delivery_kind,b.amount,pid,snap,case when p_historical_fulfilled then 'fulfilled' else 'pending' end,
  case when p_historical_fulfilled then now() end,case when p_historical_fulfilled then auth.uid() end,p_note,case when p_historical_fulfilled and b.delivery_kind='physical_pix' then now() end,case when p_historical_fulfilled and b.delivery_kind='physical_pix' then p_note end);
  insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),b.placement||'º maior comprador apurado: '||w.customer_id||' · '||w.quantity||' cotas; bônus '||b.title||case when p_historical_fulfilled then ' · Entrega anterior conferida: '||p_note else ' · Pendente de entrega/pagamento' end);
 end loop;
end;$function$;

create or replace function public.fulfill_raffle_buyer_placement(p_campaign uuid, p_note text,p_placement integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.raffle_buyer_results%rowtype;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 perform 1 from public.raffle_campaigns where id=p_campaign for update;
 select * into r from public.raffle_buyer_results where campaign_id=p_campaign and placement=p_placement for update;
 if not found or r.status<>'pending' or r.delivery_kind='physical' then raise exception 'Bônus indisponível. Produtos físicos seguem o fluxo de envio.';end if;
 if length(btrim(coalesce(p_note,''))) not between 10 and 500 then raise exception 'Informe a referência do pagamento ou voucher (10 a 500 caracteres).';end if;
 if r.delivery_kind='physical_pix' then
  if r.pix_paid_at is not null then raise exception 'O Pix deste bônus já foi confirmado.';end if;
  if r.amount is null or r.amount<=0 then raise exception 'Valor do Pix inválido.';end if;
  update public.raffle_buyer_results set pix_paid_at=now(),pix_payment_note=btrim(p_note) where campaign_id=p_campaign and placement=p_placement;
  if exists(select 1 from public.raffle_awards a join public.logistics_pending l on l.id=a.logistics_id join public.shipments s on s.id=l.shipment_id where a.prize_id=r.prize_id and s.status='delivered') then
   update public.raffle_buyer_results set status='fulfilled',fulfilled_at=now(),fulfilled_by=auth.uid(),fulfillment_note='Produto entregue e Pix confirmado: '||btrim(p_note) where campaign_id=p_campaign and placement=p_placement;
  end if;
  insert into public.raffle_events(campaign_id,actor,action) values(p_campaign,auth.uid(),'Pix adicional do maior comprador confirmado: R$ '||r.amount||' · '||btrim(p_note));
  return;
 end if;
 update public.raffle_buyer_results set status='fulfilled',fulfilled_at=now(),fulfilled_by=auth.uid(),fulfillment_note=btrim(p_note) where campaign_id=p_campaign and placement=p_placement;
 insert into public.raffle_events(campaign_id,actor,action) values(p_campaign,auth.uid(),'Bônus do maior comprador cumprido: '||btrim(p_note));
end;$function$;

revoke all on function public.fulfill_raffle_buyer_placement(uuid,text,integer) from public,anon;
grant execute on function public.fulfill_raffle_buyer_placement(uuid,text,integer) to authenticated;
create or replace function public.fulfill_raffle_buyer_bonus(p_campaign uuid,p_note text)
returns void language sql set search_path='' as $$
 select public.fulfill_raffle_buyer_placement(p_campaign,p_note,1);
$$;

create or replace function public.issue_raffle_auction_voucher() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.delivery_kind='voucher' and new.status='pending' then
  insert into public.auction_vouchers(campaign_id,placement,customer_id,title,amount,remaining)
  values(new.campaign_id,new.placement,new.customer_id,new.title,new.amount,new.amount) on conflict(campaign_id,placement) do nothing;
  update public.raffle_buyer_results set status='fulfilled',fulfilled_at=now(),fulfillment_note='Crédito de voucher disponibilizado automaticamente para uso nos lotes do leilão.' where campaign_id=new.campaign_id and placement=new.placement;
 end if;
 return new;
end;$$;

create or replace function public.apply_lot_auction_voucher() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_id uuid;new_id uuid;old_amount numeric:=0;new_amount numeric:=0;v public.auction_vouchers%rowtype;financial boolean:=false;
begin
 if tg_op<>'INSERT' then
  old_id:=old.auction_voucher_id;
  if old.status<>'cancelled' then old_amount:=old.voucher_amount;end if;
 end if;
 if tg_op<>'DELETE' then
  new_id:=new.auction_voucher_id;
  if new.status<>'cancelled' then new_amount:=new.voucher_amount;end if;
  if new.voucher_amount<0 or new.voucher_amount>new.discount_amount or (new.voucher_amount>0)<>(new_id is not null) then raise exception 'Confira o voucher e o desconto do lote.';end if;
 end if;
 financial:=tg_op='DELETE' or tg_op='INSERT';
 if tg_op='UPDATE' then financial:=(old_id,old.voucher_amount,old.customer_id,old.arremate_value,old.discount_amount) is distinct from (new_id,new.voucher_amount,new.customer_id,new.arremate_value,new.discount_amount) or (old.status='cancelled')<>(new.status='cancelled');end if;
 if old_id is null and new_id is null then return coalesce(new,old);end if;
 if financial then
  if not (public.has_staff_write() is true or current_setting('role',true)='service_role' or (session_user='postgres' and current_setting('role',true) in('none','postgres'))) then raise exception 'Acesso negado.' using errcode='42501';end if;
  if tg_op<>'INSERT' and (old.charge_id is not null or old.paid_at is not null or old.status in('shipped','delivered') or old.moved_at is not null or (old.status='paid' and old.arremate_value>0)) then raise exception 'Confira o pagamento, a movimentação e o Pix antes de alterar o voucher.';end if;
  perform id from public.auction_vouchers where id in(old_id,new_id) order by id for update;
  if new_amount>0 then
   select * into v from public.auction_vouchers where id=new_id;
   if not found or v.customer_id<>new.customer_id or exists(select 1 from public.raffle_buyer_results where campaign_id=v.campaign_id and placement=v.placement and status='review') then raise exception 'Voucher indisponível para este cliente ou em revisão.';end if;
   if new_amount>(v.remaining+case when old_id=new_id then old_amount else 0 end) then raise exception 'Saldo de voucher insuficiente. Atualize o cadastro do lote.';end if;
  end if;
  if old_amount>0 then
   update public.auction_vouchers set remaining=remaining+old_amount where id=old_id;
   insert into public.auction_voucher_movements(voucher_id,lot_id,delta,actor) values(old_id,old.id,old_amount,auth.uid());
  end if;
  if new_amount>0 then
   update public.auction_vouchers set remaining=remaining-new_amount where id=new_id;
   insert into public.auction_voucher_movements(voucher_id,lot_id,delta,actor) values(new_id,new.id,-new_amount,auth.uid());
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;
 if new_amount>0 and new.arremate_value=0 and new.status='pending_payment' then new.status:='paid';end if;
 if tg_op='UPDATE' and old.voucher_amount>0 and old.arremate_value=0 and old.status='paid' and old.paid_at is null and new.arremate_value>0 and new.status='paid' then new.status:='pending_payment';end if;
 return new;
end;$$;

create or replace function public.get_admin_auction_voucher_detail(p_voucher uuid, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare header jsonb;movements_count integer;lots_count integer;page integer;
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 select jsonb_build_object('id',v.id,'customer_id',v.customer_id,'customer_name',c.name,'phone_e164',c.phone_e164,
  'title',v.title,'campaign_title',coalesce(campaign.title,'Emissão manual'),'campaign_id',v.campaign_id,'amount',v.amount,'remaining',v.remaining,'status',coalesce(r.status,'fulfilled'))
 into header from public.auction_vouchers v join public.customers c on c.id=v.customer_id
 left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id and r.placement=v.placement left join public.raffle_campaigns campaign on campaign.id=v.campaign_id where v.id=p_voucher;
 if header is null then return null;end if;
 select count(*) into movements_count from public.auction_voucher_movements where voucher_id=p_voucher;
 select count(*) into lots_count from public.lots where auction_voucher_id=p_voucher;
 page:=greatest(1,least(coalesce(p_page,1),10000,greatest(1,ceil(greatest(movements_count,lots_count)/25.0)::integer)));
 return jsonb_build_object('voucher',header,'page',page,'total',greatest(movements_count,lots_count),'movements_total',movements_count,'lots_total',lots_count,
  'movements',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
   select m.id,m.lot_id,m.delta,m.created_at,l.code as lot_code from public.auction_voucher_movements m left join public.lots l on l.id=m.lot_id
   where m.voucher_id=p_voucher order by m.created_at desc,m.id limit 25 offset (page-1)*25
  ) x),'[]'::jsonb),
  'lots',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
   select l.id,l.code,l.title,l.status,l.arremate_value,l.voucher_amount,l.created_at from public.lots l
   where l.auction_voucher_id=p_voucher order by l.created_at desc,l.id limit 25 offset (page-1)*25
  ) x),'[]'::jsonb));
end;$function$;

create or replace function public.get_admin_auction_voucher_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 return (
  with allocations as (
   select auction_voucher_id,
    coalesce(sum(voucher_amount) filter(where status='pending_payment'),0) reserved,
    coalesce(sum(voucher_amount) filter(where status in('paid','shipped','delivered')),0) used
   from public.lots where auction_voucher_id is not null group by auction_voucher_id
  ) select jsonb_build_object(
   'issued',coalesce(sum(v.amount),0),
   'available',coalesce(sum(v.remaining) filter(where (v.campaign_id is null or r.status<>'review')),0),
   'reserved',coalesce(sum(a.reserved),0),'used',coalesce(sum(a.used),0),
   'review',coalesce(sum(v.remaining) filter(where r.status='review'),0),
   'clients',count(distinct v.customer_id) filter(where v.remaining>0 and (v.campaign_id is null or r.status<>'review')),
   'vouchers',count(v.id)
  ) from public.auction_vouchers v left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id and r.placement=v.placement
  left join allocations a on a.auction_voucher_id=v.id
 );
end;$function$;

create or replace function public.get_admin_auction_vouchers(p_query text DEFAULT ''::text, p_status text DEFAULT 'all'::text, p_page integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or public.is_admin() is not true then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_status is null or p_status not in('all','available','reserved','used','review') then raise exception 'Filtro inválido.';end if;
 return (
  with allocations as (
   select auction_voucher_id,
    coalesce(sum(voucher_amount) filter(where status='pending_payment'),0) reserved,
    coalesce(sum(voucher_amount) filter(where status in('paid','shipped','delivered')),0) used
   from public.lots where auction_voucher_id is not null group by auction_voucher_id
  ), filtered as (
   select v.id,v.customer_id,c.name as customer_name,c.phone_e164,v.title,v.amount,
    v.remaining,coalesce(r.status,'fulfilled') as status,coalesce(campaign.title,'Emissão manual') as campaign_title,v.campaign_id,v.created_at,
    coalesce(a.reserved,0) reserved,coalesce(a.used,0) used
   from public.auction_vouchers v left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id and r.placement=v.placement
   left join public.raffle_campaigns campaign on campaign.id=v.campaign_id join public.customers c on c.id=v.customer_id
   left join allocations a on a.auction_voucher_id=v.id
   where (coalesce(btrim(p_query),'')='' or position(lower(left(btrim(p_query),120)) in lower(coalesce(c.name,'')||' '||coalesce(c.phone_e164,'')||' '||v.title||' '||coalesce(campaign.title,'Emissão manual')))>0)
   and (p_status='all' or (p_status='available' and v.remaining>0 and (v.campaign_id is null or r.status<>'review'))
    or (p_status='reserved' and coalesce(a.reserved,0)>0) or (p_status='used' and coalesce(a.used,0)>0)
    or (p_status='review' and r.status='review'))
  ), meta as (select count(*) total from filtered), paging as (
   select greatest(1,least(coalesce(p_page,1),10000,greatest(1,ceil(total/25.0)::integer))) page,total from meta
  ), items as (select * from filtered order by created_at desc,id limit 25 offset ((select page from paging)-1)*25)
  select jsonb_build_object('summary',public.get_admin_auction_voucher_summary(),'total',paging.total,'page',paging.page,
   'items',coalesce((select jsonb_agg(to_jsonb(items) order by created_at desc,id) from items),'[]'::jsonb)) from paging
 );
end;$function$;

create or replace function public.get_auction_vouchers(p_customer uuid DEFAULT NULL::uuid, p_lot uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c uuid;
begin
 if public.is_admin() and auth.uid() is not null then c:=p_customer;
 else c:=public.current_customer_id();if c is null or (p_customer is not null and p_customer<>c) or p_lot is not null then raise exception 'Acesso negado.' using errcode='42501';end if;end if;
 if c is null then return '[]'::jsonb;end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'title',v.title,'amount',v.amount,'remaining',v.remaining,'available',v.remaining+coalesce(l.voucher_amount,0)) order by v.created_at,v.id),'[]'::jsonb)
 from public.auction_vouchers v left join public.raffle_buyer_results r on r.campaign_id=v.campaign_id and r.placement=v.placement
 left join public.lots l on l.id=p_lot and l.customer_id=c and l.auction_voucher_id=v.id and l.status<>'cancelled'
 where v.customer_id=c and (v.campaign_id is null or r.status<>'review') and (v.remaining>0 or l.voucher_amount>0));
end;$function$;

create or replace function public.get_my_raffle_buyer_bonuses()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('campaign_id',r.campaign_id,'placement',r.placement,'campaign_title',c.title,'title',r.title,'delivery_kind',r.delivery_kind,'amount',r.amount,'quantity',r.quantity,'status',r.status,'fulfilled_at',r.fulfilled_at,'pix_paid_at',r.pix_paid_at,'has_logistics',r.prize_id is not null,'voucher_issued',v.id is not null,'voucher_available',v.remaining) order by r.created_at desc),'[]'::jsonb)
 from public.raffle_buyer_results r join public.raffle_campaigns c on c.id=r.campaign_id left join public.auction_vouchers v on v.campaign_id=r.campaign_id and v.placement=r.placement
 where auth.uid() is not null and r.customer_id=public.current_customer_id();
$function$;

create or replace function public.get_raffle_buyer_bonus(p_campaign uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',b.title,'delivery_kind',b.delivery_kind,'amount',b.amount,
  'rule','Maior quantidade de cotas pagas. Empate: quem atingir o total primeiro com pagamentos confirmados. Empate exato exige conferência.')
 from public.raffle_buyer_bonus b join public.raffle_campaigns c on c.id=b.campaign_id
 where b.campaign_id=p_campaign and b.placement=1 and ((c.status in ('open','paused','closed') and c.archived_at is null) or public.is_admin());
$$;

create function public.get_raffle_buyer_placements(p_campaign uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('placement', b.placement,'title',b.title,'delivery_kind',b.delivery_kind,'amount',b.amount) order by b.placement),'[]'::jsonb)
 from public.raffle_buyer_bonus b join public.raffle_campaigns c on c.id=b.campaign_id
 where b.campaign_id=p_campaign and ((c.status in ('open','paused','closed') and c.archived_at is null) or public.is_admin());
$$;
revoke all on function public.get_raffle_buyer_placements(uuid) from public;
grant execute on function public.get_raffle_buyer_placements(uuid) to anon,authenticated;

create or replace function public.duplicate_raffle_campaign(p_source uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare destination uuid;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 destination:=public.duplicate_raffle_campaign_before_buyer_bonus(p_source,p_request);
 insert into public.raffle_buyer_bonus(campaign_id,placement,title,delivery_kind,amount)
 select destination,placement,title,delivery_kind,amount from public.raffle_buyer_bonus where campaign_id=p_source
 on conflict(campaign_id,placement) do nothing;
 return destination;
end;$$;

commit;
