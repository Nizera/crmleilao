import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
test('reposições excluem prêmios da lista e das ações sem remover os itens da logística',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function public.has_staff_write() returns boolean language sql as $$select true$$;
 create table public.logistics_pending(id uuid primary key,customer_id uuid,source_kind text,shipment_id uuid,cancelled_at timestamptz,cancelled_by uuid,moved_at timestamptz,moved_by uuid,shipping_date date);
 create view public.logistics_pending_list as select * from public.logistics_pending;
 insert into public.logistics_pending(id,customer_id,source_kind) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','raffle'),('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','replacement');`);
 await db.exec(fs.readFileSync('supabase/migrations/0065_separate_raffle_replacements.sql','utf8'));
 assert.equal((await db.query('select count(*)::int n from logistics_replacement_list')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from logistics_pending_list')).rows[0].n,2);
 for(const action of ['box','reopen','cancel','reschedule'])await assert.rejects(()=>db.query("select handle_logistics_pending('22222222-2222-4222-8222-222222222222',$1,'2026-11-10')",[action]),/prêmio de rifa/);
 await db.query("select handle_logistics_pending('33333333-3333-4333-8333-333333333333','box')");
 assert.ok((await db.query("select moved_at from logistics_pending where source_kind='replacement'")).rows[0].moved_at);
 assert.equal((await db.query("select moved_at from logistics_pending where source_kind='raffle'")).rows[0].moved_at,null);
 }finally{await db.close();}
});
