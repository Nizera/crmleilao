import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';
test('editar/excluir prêmio protege reservas, ganhadores, concorrência e permissões',async()=>{
 const db=new PGlite();try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function public.has_staff_write() returns boolean language sql as $$select current_setting('test.staff',true)='yes'$$;
 create table raffle_campaigns(id uuid primary key,status text,archived_at timestamptz);
 create table raffle_prizes(id uuid primary key,campaign_id uuid,title text,kind text,number integer,image_urls text[]);
 create table raffle_awards(prize_id uuid);
 create table raffle_allocations(campaign_id uuid,number integer);
 create table raffle_events(campaign_id uuid,actor uuid,action text);
 insert into raffle_campaigns values('22222222-2222-4222-8222-222222222222','paused',null);
 insert into raffle_prizes values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Original','instant',7,array['foto.webp']);`);
 await db.exec(fs.readFileSync('supabase/migrations/0067_raffle_prize_edit_delete.sql','utf8'));
 const call=(action='edit',title='Novo',expected='Original')=>db.query("select edit_raffle_instant_prize('33333333-3333-4333-8333-333333333333',$1,$2,$3)",[action,title,expected]);
 await assert.rejects(()=>call(),/Acesso negado/);await db.exec("set test.staff='yes'");
 await call();let prize=(await db.query('select * from raffle_prizes')).rows[0];assert.equal(prize.title,'Novo');assert.equal(prize.number,7);assert.deepEqual(prize.image_urls,['foto.webp']);
 await assert.rejects(()=>call(),/atualizado/);
 await db.exec("update raffle_campaigns set status='open'");await assert.rejects(()=>call('delete','','Novo'),/Pause/);await db.exec("update raffle_campaigns set status='paused'");
 await db.exec("insert into raffle_allocations values('22222222-2222-4222-8222-222222222222',7)");await assert.rejects(()=>call('delete','','Novo'),/reservado/);await assert.rejects(()=>call('edit','Outro','Novo'),/reservado/);
 await db.exec("delete from raffle_allocations;insert into raffle_awards values('33333333-3333-4333-8333-333333333333')");await assert.rejects(()=>call('delete','','Novo'),/encontrado/);
 await db.exec('delete from raffle_awards');await call('delete','','Novo');assert.equal((await db.query('select count(*)::int n from raffle_prizes')).rows[0].n,0);assert.equal((await db.query('select count(*)::int n from raffle_events')).rows[0].n,2);
 await db.exec('set role anon');await assert.rejects(()=>call(),/permission denied/);
 }finally{await db.close();}
});
