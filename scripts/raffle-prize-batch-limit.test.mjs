import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('50 tipos são salvos uma vez; limites e acesso continuam protegidos',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
   create function public.has_staff_write() returns boolean language sql as $$select current_setting('test.staff',true)='yes'$$;
   create table public.raffle_campaigns(id uuid primary key,status text,total_numbers integer,archived_at timestamptz);
   create table public.raffle_prizes(id uuid primary key default gen_random_uuid(),campaign_id uuid,title text,kind text,number integer,image_urls text[],unique(campaign_id,number));
   create table public.raffle_allocations(campaign_id uuid,number integer);
   create table public.raffle_events(campaign_id uuid,actor uuid,action text);
   insert into public.raffle_campaigns values('22222222-2222-4222-8222-222222222222','draft',1000,null);`);
  await db.exec(fs.readFileSync('supabase/migrations/0069_raffle_prize_batch_limit.sql','utf8'));
  const campaign='22222222-2222-4222-8222-222222222222';
  const key='33333333-3333-4333-8333-333333333333';
  const items=Array.from({length:50},(_,i)=>({title:`Prêmio ${i+1}`,quantity:1,image_urls:[]}));
  const call=(rows,k=key)=>db.query('select public.add_raffle_instant_prizes($1,$2,$3::jsonb)',[campaign,k,JSON.stringify(rows)]);
  await assert.rejects(()=>call(items),/Acesso negado/);
  await db.exec("set test.staff='yes'");
  await call(items);await call(items);
  const rows=(await db.query('select * from public.raffle_prizes')).rows;
  assert.equal(rows.length,50);assert.equal(new Set(rows.map(x=>x.number)).size,50);
  await assert.rejects(()=>call(Array.from({length:101},()=>items[0]),'44444444-4444-4444-8444-444444444444'),/100 tipos/);
  await assert.rejects(()=>call(items.map(x=>({...x,quantity:3})),'55555555-5555-4555-8555-555555555555'),/100 novos/);
  assert.equal((await db.query('select count(*)::int n from public.raffle_prizes')).rows[0].n,50);
  await db.exec("update public.raffle_campaigns set status='open'");
  await assert.rejects(()=>call(items,'66666666-6666-4666-8666-666666666666'),/Pause/);
  assert.equal((await db.query("select has_function_privilege('anon','public.add_raffle_instant_prizes(uuid,uuid,jsonb)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
