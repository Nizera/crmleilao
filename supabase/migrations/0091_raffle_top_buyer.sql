begin;

alter table public.raffle_prizes drop constraint raffle_prizes_kind_check, drop constraint raffle_prizes_check;
alter table public.raffle_prizes add constraint raffle_prizes_kind_check check(kind in ('main','instant','buyer')),
 add constraint raffle_prizes_check check((kind in ('main','buyer') and number is null) or (kind='instant' and number>=0));

create table public.raffle_buyer_bonus (
 campaign_id uuid primary key references public.raffle_campaigns(id) on delete cascade,
 title text not null check(length(btrim(title)) between 3 and 120),
 delivery_kind text not null check(delivery_kind in ('physical','pix','voucher')),
 amount numeric(12,2) check(amount>0 and amount<=100000),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 check(delivery_kind='physical' or amount is not null)
);
create table public.raffle_buyer_results (
 campaign_id uuid primary key references public.raffle_buyer_bonus(campaign_id),
 customer_id uuid not null references public.customers(id),
 quantity integer not null check(quantity>0), reached_at timestamptz not null,
 title text not null, delivery_kind text not null, amount numeric(12,2),
 status text not null default 'pending' check(status in ('pending','fulfilled','review')),
 prize_id uuid unique references public.raffle_prizes(id),
 -- Snapshot is private: full order references and payment times never reach public ranking.
 snapshot jsonb not null, created_at timestamptz not null default now(),
 fulfilled_at timestamptz, fulfilled_by uuid references public.admin_profiles(id), fulfillment_note text,
 check(fulfilled_by is null or fulfilled_at is not null)
);
create index raffle_buyer_results_customer on public.raffle_buyer_results(customer_id);
alter table public.raffle_buyer_bonus enable row level security;
alter table public.raffle_buyer_results enable row level security;
revoke all on public.raffle_buyer_bonus,public.raffle_buyer_results from public,anon,authenticated;
grant select on public.raffle_buyer_bonus,public.raffle_buyer_results to authenticated;
grant all on public.raffle_buyer_bonus,public.raffle_buyer_results to service_role;
create policy buyer_bonus_staff on public.raffle_buyer_bonus for select to authenticated using(public.is_admin());
create policy buyer_results_staff on public.raffle_buyer_results for select to authenticated using(public.is_admin());

-- Each customer's final paid total is reached at their LAST confirmed payment,
-- rather than their first purchase. Unknown payment time is never silently guessed.
create function public.raffle_buyer_totals(p_campaign uuid)
returns table(customer_id uuid,quantity bigint,reached_at timestamptz,missing_time boolean)
language sql stable security definer set search_path='' as $$
 select o.customer_id,sum(cardinality(o.numbers)),max(o.paid_at),bool_or(o.paid_at is null)
 from public.raffle_orders o where o.campaign_id=p_campaign and o.status='paid'
 group by o.customer_id;
$$;
revoke all on function public.raffle_buyer_totals(uuid) from public,anon,authenticated,service_role;

create function public.set_raffle_buyer_bonus(p_campaign uuid,p_title text,p_kind text,p_amount numeric,p_expected integer)
returns void language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype; b public.raffle_buyer_bonus%rowtype;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 if not found or c.archived_at is not null or c.status not in ('draft','paused') then raise exception 'Salve em rascunho ou pause a campanha.';end if;
 if exists(select 1 from public.raffle_orders where campaign_id=c.id) then raise exception 'O bônus não pode mudar após a primeira reserva.';end if;
 select * into b from public.raffle_buyer_bonus where campaign_id=c.id;
 if coalesce(b.version,0) is distinct from p_expected then raise exception 'O bônus mudou. Atualize a página.';end if;
 if length(btrim(coalesce(p_title,''))) not between 3 and 120 or p_kind is null or p_kind not in ('physical','pix','voucher')
  or (p_kind<>'physical' and (p_amount is null or p_amount<=0 or p_amount>100000)) then raise exception 'Confira o prêmio e o valor.';end if;
 insert into public.raffle_buyer_bonus(campaign_id,title,delivery_kind,amount) values(c.id,btrim(p_title),p_kind,case when p_kind='physical' then null else round(p_amount,2) end)
 on conflict(campaign_id) do update set title=excluded.title,delivery_kind=excluded.delivery_kind,amount=excluded.amount,version=raffle_buyer_bonus.version+1;
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),'Bônus de maior comprador configurado; cotas pagas; desempate por quem atingir o total primeiro. Empate exato exige conferência.');
end;$$;
revoke all on function public.set_raffle_buyer_bonus(uuid,text,text,numeric,integer) from public,anon;
grant execute on function public.set_raffle_buyer_bonus(uuid,text,text,numeric,integer) to authenticated;

create function public.finalize_raffle_buyer_bonus(p_campaign uuid,p_historical_fulfilled boolean default false,p_note text default null)
returns void language plpgsql security definer set search_path='' as $$
declare c public.raffle_campaigns%rowtype;b public.raffle_buyer_bonus%rowtype;w record;ties integer;pid uuid;oid uuid;num integer;snap jsonb;
begin
 select * into c from public.raffle_campaigns where id=p_campaign for update;
 select * into b from public.raffle_buyer_bonus where campaign_id=p_campaign;
 if b.campaign_id is null then return;end if;
 if c.status<>'closed' then raise exception 'Encerre a campanha antes de apurar o bônus.';end if;
 if exists(select 1 from public.raffle_buyer_results where campaign_id=c.id) then return;end if;
 if exists(select 1 from public.raffle_orders where campaign_id=c.id and status in ('creating','pending','review')) then raise exception 'Resolva as reservas pendentes antes de apurar o maior comprador.';end if;
 select * into w from public.raffle_buyer_totals(c.id) order by quantity desc,reached_at asc nulls last,customer_id limit 1;
 if not found then raise exception 'Não há compras pagas para apurar o bônus.';end if;
 if exists(select 1 from public.raffle_buyer_totals(c.id) where quantity=w.quantity and missing_time) then raise exception 'Confira as datas de confirmação de pagamento antes de apurar o maior comprador.';end if;
 select count(*) into ties from public.raffle_buyer_totals(c.id) where quantity=w.quantity and reached_at=w.reached_at;
 if ties>1 then raise exception 'Empate exato no maior comprador. Confira o regulamento antes de encerrar.';end if;
 select jsonb_agg(jsonb_build_object('order',id,'quantity',cardinality(numbers),'paid_at',paid_at,'amount',amount) order by paid_at,id)
 into snap from public.raffle_orders where campaign_id=c.id and customer_id=w.customer_id and status='paid';
 if b.delivery_kind='physical' and not p_historical_fulfilled then
  insert into public.raffle_prizes(campaign_id,title,kind) values(c.id,left('Maior comprador · '||b.title,160),'buyer') returning id into pid;
  select id,numbers[1] into oid,num from public.raffle_orders where campaign_id=c.id and customer_id=w.customer_id and status='paid' order by paid_at desc,id limit 1;
  perform public.materialize_raffle_award(pid,oid,num,'Maior comprador: '||w.quantity||' cotas pagas; total atingido em '||w.reached_at,null);
  update public.logistics_pending set reason='Maior comprador da rifa: '||c.title||' · '||w.quantity||' cotas pagas' where id=(select logistics_id from public.raffle_awards where prize_id=pid);
 end if;
 insert into public.raffle_buyer_results(campaign_id,customer_id,quantity,reached_at,title,delivery_kind,amount,prize_id,snapshot,status,fulfilled_at,fulfilled_by,fulfillment_note)
 values(c.id,w.customer_id,w.quantity,w.reached_at,b.title,b.delivery_kind,b.amount,pid,snap,case when p_historical_fulfilled then 'fulfilled' else 'pending' end,
 case when p_historical_fulfilled then now() end,case when p_historical_fulfilled then auth.uid() end,p_note);
 insert into public.raffle_events(campaign_id,actor,action) values(c.id,auth.uid(),'Maior comprador apurado: '||w.customer_id||' · '||w.quantity||' cotas; bônus '||b.title||case when p_historical_fulfilled then ' · Entrega anterior conferida: '||p_note else ' · Pendente de entrega/pagamento' end);
end;$$;
revoke all on function public.finalize_raffle_buyer_bonus(uuid,boolean,text) from public,anon,authenticated,service_role;

create function public.raffle_buyer_on_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='closed' and old.status is distinct from 'closed' then perform public.finalize_raffle_buyer_bonus(new.id);end if;
 return new;
end;$$;
revoke all on function public.raffle_buyer_on_close() from public,anon,authenticated,service_role;
create trigger raffle_buyer_on_close after update of status on public.raffle_campaigns for each row execute function public.raffle_buyer_on_close();

create function public.confirm_historical_buyer_bonus(p_campaign uuid,p_already_fulfilled boolean,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if public.has_staff_write() is not true or auth.uid() is null or public.is_owner() is not true then raise exception 'Apenas o dono pode conferir premiações anteriores.' using errcode='42501';end if;
 if p_already_fulfilled is null or length(btrim(coalesce(p_note,''))) not between 10 and 500 then raise exception 'Registre a conferência da entrega anterior (10 a 500 caracteres).';end if;
 perform public.finalize_raffle_buyer_bonus(p_campaign,p_already_fulfilled,p_note);
end;$$;
revoke all on function public.confirm_historical_buyer_bonus(uuid,boolean,text) from public,anon;
grant execute on function public.confirm_historical_buyer_bonus(uuid,boolean,text) to authenticated;

create function public.fulfill_raffle_buyer_bonus(p_campaign uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare r public.raffle_buyer_results%rowtype;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 perform 1 from public.raffle_campaigns where id=p_campaign for update;
 select * into r from public.raffle_buyer_results where campaign_id=p_campaign for update;
 if not found or r.status<>'pending' or r.delivery_kind='physical' then raise exception 'Bônus indisponível. Produtos físicos seguem o fluxo de envio.';end if;
 if length(btrim(coalesce(p_note,''))) not between 10 and 500 then raise exception 'Informe a referência do pagamento ou voucher (10 a 500 caracteres).';end if;
 update public.raffle_buyer_results set status='fulfilled',fulfilled_at=now(),fulfilled_by=auth.uid(),fulfillment_note=btrim(p_note) where campaign_id=p_campaign;
 insert into public.raffle_events(campaign_id,actor,action) values(p_campaign,auth.uid(),'Bônus do maior comprador cumprido: '||btrim(p_note));
end;$$;
revoke all on function public.fulfill_raffle_buyer_bonus(uuid,text) from public,anon;
grant execute on function public.fulfill_raffle_buyer_bonus(uuid,text) to authenticated;

-- A later refund, payment or changed allocation must flag the frozen result,
-- never quietly reassign a prize already separated or paid.
create function public.review_raffle_buyer_changes() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status is distinct from new.status or old.numbers is distinct from new.numbers or old.customer_id is distinct from new.customer_id or old.paid_at is distinct from new.paid_at then
  update public.raffle_buyer_results set status='review' where campaign_id=new.campaign_id and status<>'review';
  if found then insert into public.raffle_events(campaign_id,actor,action) values(new.campaign_id,auth.uid(),'Maior comprador exige revisão: compra alterada após apuração. Resultado preservado.');end if;
 end if;
 return new;
end;$$;
revoke all on function public.review_raffle_buyer_changes() from public,anon,authenticated,service_role;
create trigger review_raffle_buyer_changes after update of status,numbers,customer_id,paid_at on public.raffle_orders for each row execute function public.review_raffle_buyer_changes();

create function public.guard_buyer_bonus_shipping() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.raffle_buyer_results r join public.raffle_awards a on a.prize_id=r.prize_id where a.logistics_id=new.id and r.status='review') then
  raise exception 'O bônus de maior comprador está em revisão. Confira os pagamentos antes de movimentar ou enviar.';
 end if;
 return new;
end;$$;
revoke all on function public.guard_buyer_bonus_shipping() from public,anon,authenticated,service_role;
create trigger guard_buyer_bonus_shipping before update of moved_at,shipment_id on public.logistics_pending for each row execute function public.guard_buyer_bonus_shipping();

create function public.complete_buyer_bonus_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='delivered' and old.status is distinct from 'delivered' then
  update public.raffle_buyer_results r set status='fulfilled',fulfilled_at=now(),fulfilled_by=auth.uid(),fulfillment_note='Entrega confirmada pelo acompanhamento do envio.'
  from public.raffle_awards a join public.logistics_pending l on l.id=a.logistics_id
  where r.prize_id=a.prize_id and l.shipment_id=new.id and r.status='pending' and r.delivery_kind='physical';
 end if;
 return new;
end;$$;
revoke all on function public.complete_buyer_bonus_delivery() from public,anon,authenticated,service_role;
create trigger complete_buyer_bonus_delivery after update of status on public.shipments for each row execute function public.complete_buyer_bonus_delivery();

create or replace function public.get_raffle_awards(p_page integer default 1,p_orders uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if public.current_customer_id() is null and not public.is_admin() then raise exception 'Acesso negado.' using errcode='42501';end if;
 if p_orders is not null and cardinality(p_orders)>10 then raise exception 'Limite de pedidos por consulta.';end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
  select a.id,a.campaign_id,a.order_id,a.customer_id,a.number,a.logistics_id,p.title,p.kind,c.title campaign_title,c.total_numbers,
   cu.name customer_name,l.moved_at,l.shipment_id,l.cancelled_at,
   case when r.status='review' then 'review' else o.status end order_status,s.tracking_code,s.status shipment_status
  from public.raffle_awards a join public.raffle_orders o on o.id=a.order_id join public.customers cu on cu.id=a.customer_id
  join public.raffle_prizes p on p.id=a.prize_id join public.raffle_campaigns c on c.id=a.campaign_id
  join public.logistics_pending l on l.id=a.logistics_id left join public.shipments s on s.id=l.shipment_id
  left join public.raffle_buyer_results r on r.prize_id=p.id
  where (public.is_admin() or a.customer_id=public.current_customer_id()) and (p_orders is null or a.order_id=any(p_orders))
  order by a.created_at desc,a.id limit (case when p_orders is null then 20 else 2000 end)
  offset (case when p_orders is null then (greatest(1,least(coalesce(p_page,1),10000))-1)*20 else 0 end)
 ) x);
end;$$;
revoke all on function public.get_raffle_awards(integer,uuid[]) from public,anon;
grant execute on function public.get_raffle_awards(integer,uuid[]) to authenticated;

create function public.get_raffle_buyer_bonus(p_campaign uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',b.title,'delivery_kind',b.delivery_kind,'amount',b.amount,
  'rule','Maior quantidade de cotas pagas. Empate: quem atingir o total primeiro com pagamentos confirmados. Empate exato exige conferência.')
 from public.raffle_buyer_bonus b join public.raffle_campaigns c on c.id=b.campaign_id
 where b.campaign_id=p_campaign and ((c.status in ('open','paused','closed') and c.archived_at is null) or public.is_admin());
$$;
revoke all on function public.get_raffle_buyer_bonus(uuid) from public;
grant execute on function public.get_raffle_buyer_bonus(uuid) to anon,authenticated;

-- Customer output deliberately excludes snapshot, staff notes and other winners.
create function public.get_my_raffle_buyer_bonuses()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('campaign_id',r.campaign_id,'campaign_title',c.title,'title',r.title,'delivery_kind',r.delivery_kind,'amount',r.amount,'quantity',r.quantity,'status',r.status,'fulfilled_at',r.fulfilled_at,'has_logistics',r.prize_id is not null) order by r.created_at desc),'[]'::jsonb)
 from public.raffle_buyer_results r join public.raffle_campaigns c on c.id=r.campaign_id
 where auth.uid() is not null and r.customer_id=public.current_customer_id();
$$;
revoke all on function public.get_my_raffle_buyer_bonuses() from public,anon;
grant execute on function public.get_my_raffle_buyer_bonuses() to authenticated;

create or replace function public.get_public_raffle_buyer_ranking(p_campaign uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with ranked as (
 select case when nullif(btrim(c.name),'') is null then 'Participante'
  when strpos(btrim(c.name),' ')=0 then btrim(c.name)
  else split_part(btrim(c.name),' ',1)||' '||left(regexp_replace(btrim(c.name),'^.*\s',''),1)||'.' end as name,
  b.quantity,row_number() over(order by b.quantity desc,b.reached_at asc nulls last,b.customer_id)::integer as position
 from public.raffle_buyer_totals(p_campaign) b join public.customers c on c.id=b.customer_id
 where exists(select 1 from public.raffle_campaigns r where r.id=p_campaign and r.status in ('open','paused','closed') and r.archived_at is null)
 order by position limit 3
 ) select coalesce(jsonb_agg(jsonb_build_object('name',name,'quantity',quantity,'position',position) order by position),'[]'::jsonb) from ranked;
$$;
revoke all on function public.get_public_raffle_buyer_ranking(uuid) from public;
grant execute on function public.get_public_raffle_buyer_ranking(uuid) to anon,authenticated;

create function public.get_admin_raffle_buyer_ranking(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.is_admin() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) into result from (
  select coalesce(c.name,'Cliente cadastrado') as name,b.quantity,b.reached_at,b.missing_time
  from public.raffle_buyer_totals(p_campaign) b join public.customers c on c.id=b.customer_id
  order by b.quantity desc,b.reached_at asc nulls last,b.customer_id limit 5
 ) t;
 return result;
end;$$;
revoke all on function public.get_admin_raffle_buyer_ranking(uuid) from public,anon;
grant execute on function public.get_admin_raffle_buyer_ranking(uuid) to authenticated;

-- Duplication copies the bonus rules, never a winner or a fulfillment record.
alter function public.duplicate_raffle_campaign(uuid,uuid) rename to duplicate_raffle_campaign_before_buyer_bonus;
revoke all on function public.duplicate_raffle_campaign_before_buyer_bonus(uuid,uuid) from public,anon,authenticated,service_role;
create function public.duplicate_raffle_campaign(p_source uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare destination uuid;
begin
 if public.has_staff_write() is not true or auth.uid() is null then raise exception 'Acesso negado.' using errcode='42501';end if;
 destination:=public.duplicate_raffle_campaign_before_buyer_bonus(p_source,p_request);
 insert into public.raffle_buyer_bonus(campaign_id,title,delivery_kind,amount)
 select destination,title,delivery_kind,amount from public.raffle_buyer_bonus where campaign_id=p_source
 on conflict(campaign_id) do nothing;
 return destination;
end;$$;
revoke all on function public.duplicate_raffle_campaign(uuid,uuid) from public,anon;
grant execute on function public.duplicate_raffle_campaign(uuid,uuid) to authenticated;

commit;
