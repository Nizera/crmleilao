import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

test('cadastro de cotas com fotos é atômico, restrito à equipe e idempotente', async () => {
 const db = new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function public.has_staff_write() returns boolean language sql as $$select current_setting('test.staff',true)='yes'$$;
 create table public.raffle_campaigns(id uuid primary key,status text,total_numbers integer,archived_at timestamptz);
 create table public.raffle_prizes(id uuid primary key default gen_random_uuid(),campaign_id uuid,title text,kind text,number integer,unique(campaign_id,number));
 create table public.raffle_allocations(campaign_id uuid,number integer);
 create table public.raffle_events(campaign_id uuid,actor uuid,action text);
 insert into public.raffle_campaigns values('22222222-2222-4222-8222-222222222222','paused',10,null);
 insert into public.raffle_allocations values('22222222-2222-4222-8222-222222222222',0);`);
 const sql = fs.readFileSync('supabase/migrations/0064_raffle_prize_photos.sql','utf8');
 await db.exec(sql);
 const prefix = sql.match(/<>'(https:[^']+)'/)[1];
 const campaign='22222222-2222-4222-8222-222222222222', key='33333333-3333-4333-8333-333333333333';
 const call=(items,k=key)=>db.query('select public.add_raffle_instant_prizes($1,$2,$3::jsonb)',[campaign,k,JSON.stringify(items)]);
 const items=[{title:'Prêmio A',quantity:2,image_urls:[prefix+'foto.webp']},{title:'Prêmio B',quantity:1,image_urls:[]}];
 await assert.rejects(()=>call(items),/Acesso negado/);
 await db.exec("set test.staff='yes'");
 await assert.rejects(()=>call([{...items[0],image_urls:['https://evil.test/image.jpg']}]),/fotos enviadas/);
 await assert.rejects(()=>call([{...items[0],quantity:1.5}]),/Quantidade inválida/);
 await call(items); await call(items);
 let rows=(await db.query('select * from public.raffle_prizes')).rows;
 assert.equal(rows.length,3); assert.equal(new Set(rows.map(x=>x.number)).size,3); assert.ok(rows.every(x=>x.number!==0));
 assert.deepEqual(rows.filter(x=>x.title==='Prêmio A').map(x=>x.image_urls),[[prefix+'foto.webp'],[prefix+'foto.webp']]);
 await assert.rejects(()=>call([{...items[0],quantity:8}],'44444444-4444-4444-8444-444444444444'),/cotas livres/);
 assert.equal((await db.query('select count(*)::int n from public.raffle_prizes')).rows[0].n,3);
 const prize=rows[0];
 await db.query('select public.set_raffle_prize_photos($1,$2::text[])',[prize.id,[prefix+'updated.webp']]);
 const updated=(await db.query('select * from public.raffle_prizes where id=$1',[prize.id])).rows[0];
 assert.equal(updated.number,prize.number);assert.deepEqual(updated.image_urls,[prefix+'updated.webp']);
 await assert.rejects(()=>db.query('select public.set_raffle_prize_photos($1,$2::text[])',[prize.id,['https://evil.test/p.png']]),/fotos enviadas/);
 await db.exec("update public.raffle_campaigns set status='open'");
 await assert.rejects(()=>call(items,'55555555-5555-4555-8555-555555555555'),/Pause/);
 assert.equal((await db.query("select has_function_privilege('anon','public.add_raffle_instant_prizes(uuid,uuid,jsonb)','execute') allowed")).rows[0].allowed,false);
 } finally { await db.close(); }
});
