-- Store-only consent and transactional delivery queue. Never backfill old sales.
begin;
create table public.store_marketing_sessions (
 id uuid primary key, consent boolean not null, consent_version text not null,
 updated_at timestamptz not null default now(), expires_at timestamptz not null default now()+interval '180 days',
 source_url text, user_agent text, fbp text, fbc text, attribution jsonb not null default '{}'
);
create table public.store_order_attribution (
 order_id uuid primary key references public.store_orders(id),
 session_id uuid not null references public.store_marketing_sessions(id),
 created_at timestamptz not null default now()
);
create index store_order_attribution_session on public.store_order_attribution(session_id);
create table public.store_meta_events (
 id uuid primary key default gen_random_uuid(), order_id uuid not null unique references public.store_orders(id),
 event_id text not null unique, event_time timestamptz not null, payload jsonb not null,
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','skipped')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 claimed_at timestamptz, lease_token uuid, sent_at timestamptz, error_code text, trace_id text,
 created_at timestamptz not null default now()
);
create index store_meta_pending on public.store_meta_events(next_attempt_at) where status in ('pending','processing');
alter table public.store_marketing_sessions enable row level security;
alter table public.store_order_attribution enable row level security;
alter table public.store_meta_events enable row level security;
revoke all on public.store_marketing_sessions,public.store_order_attribution,public.store_meta_events from public,anon,authenticated;
grant all on public.store_marketing_sessions,public.store_order_attribution,public.store_meta_events to service_role;

create function public.enqueue_store_meta_purchase(p_order uuid) returns void
language plpgsql security definer set search_path='' as $$
declare o public.store_orders%rowtype; v_items jsonb; v_value numeric;
begin
 select * into o from public.store_orders where id=p_order;
 if not found or o.payment_status <> 'paid' then return; end if;
 if not exists(select 1 from public.store_order_attribution a join public.store_marketing_sessions s on s.id=a.session_id
   where a.order_id=o.id and s.consent and s.expires_at>now()) then return; end if;
 v_value := greatest(0,o.cash_total-coalesce(o.freight_amount,0));
 if v_value <= 0 or o.coins_total > 0 then return; end if;
 select jsonb_agg(jsonb_build_object('id',i.reward_id::text,'quantity',i.quantity,'item_price',i.unit_cash) order by i.id)
 into v_items from public.store_order_items i where i.order_id=o.id and i.unit_cash>0;
 if v_items is null then return; end if;
 insert into public.store_meta_events(order_id,event_id,event_time,payload)
 values(o.id,'store_purchase_'||o.id::text,coalesce(o.paid_at,now()),jsonb_build_object(
   'currency','BRL','value',v_value,'order_id',o.id::text,'content_type','product','contents',v_items,
   'content_ids',(select jsonb_agg(x->>'id') from jsonb_array_elements(v_items) x),
   'num_items',(select sum((x->>'quantity')::integer) from jsonb_array_elements(v_items) x)))
 on conflict(order_id) do nothing;
end; $$;

create function public.on_store_meta_payment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.payment_status='paid' and old.payment_status is distinct from 'paid' then perform public.enqueue_store_meta_purchase(new.id); end if;
 return new;
end; $$;
create trigger store_meta_payment after update of payment_status on public.store_orders for each row execute function public.on_store_meta_payment();

create function public.attach_store_marketing(p_order uuid,p_customer uuid,p_session uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.store_orders where id=p_order and customer_id=p_customer and created_at>now()-interval '30 minutes' for update;
 if not found then return; end if;
 if not exists(select 1 from public.store_marketing_sessions where id=p_session and consent and expires_at>now()) then return; end if;
 insert into public.store_order_attribution(order_id,session_id) values(p_order,p_session) on conflict(order_id) do nothing;
 perform public.enqueue_store_meta_purchase(p_order);
end; $$;

create function public.claim_store_meta_events(p_limit integer default 5) returns setof public.store_meta_events
language plpgsql security definer set search_path='' as $$
begin
 update public.store_meta_events e set status='skipped',error_code='consent_or_payment_unavailable'
 where e.status in ('pending','processing') and not exists(
 select 1 from public.store_order_attribution a join public.store_marketing_sessions s on s.id=a.session_id
 join public.store_orders o on o.id=a.order_id where a.order_id=e.order_id and s.consent and s.expires_at>now() and o.payment_status='paid');
 update public.store_meta_events set status='failed',error_code='delivery_window_exceeded'
 where status in ('pending','processing') and (event_time<now()-interval '6 days' or attempts>=10);
 return query with candidates as (
 select id from public.store_meta_events where next_attempt_at<=now() and
 (status='pending' or(status='processing' and claimed_at<now()-interval '5 minutes'))
 order by next_attempt_at,id for update skip locked limit greatest(1,least(p_limit,20))
 ) update public.store_meta_events e set status='processing',claimed_at=now(),lease_token=gen_random_uuid(),attempts=attempts+1
 from candidates c where e.id=c.id returning e.*;
end; $$;
revoke all on function public.enqueue_store_meta_purchase(uuid),public.on_store_meta_payment(),public.attach_store_marketing(uuid,uuid,uuid),public.claim_store_meta_events(integer) from public,anon,authenticated;
grant execute on function public.enqueue_store_meta_purchase(uuid),public.attach_store_marketing(uuid,uuid,uuid),public.claim_store_meta_events(integer) to service_role;
commit;
