import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('advertências automáticas, bloqueio no banco, liberação auditada e permissões',async()=>{
 const db=new PGlite();const customer=crypto.randomUUID(),user=crypto.randomUUID(),admin=crypto.randomUUID(),viewer=crypto.randomUUID();
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const asUser=async(id)=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id]);await db.exec('set role authenticated');};
 try{
  await db.exec(`create role anon;create role authenticated;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
   create table customers(id uuid primary key,auth_user_id uuid);
   create table admin_profiles(id uuid primary key,role text);
   create table lots(id uuid primary key default gen_random_uuid(),customer_id uuid references customers,code text,status text,payment_expired_at timestamptz,auction_date date default current_date,created_at timestamptz default now());
   create function is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from public.admin_profiles where id=auth.uid())$$;
   grant usage on schema public,auth to anon,authenticated;grant select on customers to authenticated;`);
  await db.query('insert into customers values($1,$2)',[customer,user]);
  await db.query("insert into admin_profiles values($1,'staff'),($2,'viewer')",[admin,viewer]);
  await db.query("insert into lots(customer_id,code,status,payment_expired_at) values($1,'OLD','cancelled',now())",[customer]);
  await db.exec(await readFile('supabase/migrations/0074_customer_warnings.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/0075_customer_warnings_per_day.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/0075_customer_warnings_per_day.sql','utf8'));
  assert.equal(Number(await scalar('select count(*) from customer_access_events')),0,'não aplica retroativamente');
  const lots=[];
  for(let i=0;i<3;i++){
   await db.exec('reset role');const lot=await scalar("insert into lots(customer_id,code,status,auction_date) values($1,$2,'pending_payment',current_date+$3::integer) returning id",[customer,'EXP'+i,i]);lots.push(lot);
   await db.query("update lots set status='cancelled',payment_expired_at=now() where id=$1",[lot]);
   await db.query("update lots set status='cancelled' where id=$1",[lot]);
   for(let n=0;n<10;n++){
    const sameDay=await scalar("insert into lots(customer_id,code,status,auction_date) values($1,'SAME','pending_payment',current_date+$2::integer) returning id",[customer,i]);
    await db.query("update lots set status='cancelled',payment_expired_at=now()+interval '1 day' where id=$1",[sameDay]);
   }
   assert.equal(Number(await scalar('select count(*) from customer_access_events')),i+1,'mesmo cancelamento não duplica');
   await asUser(user);assert.equal(await scalar('select current_customer_id()'),i===2?null:customer);
   assert.equal(Number(await scalar('select warning_count from customer_access_state')),i+1);
  }
  const req=crypto.randomUUID();
  await assert.rejects(db.query("select manage_customer_access($1,$2,'unblock','Cliente pediu')",[customer,req]),/Acesso negado/);
  await assert.rejects(db.query("update customer_access_state set blocked_at=null,warning_count=0"),/permission denied/);
  await assert.rejects(db.query("select record_customer_warning($1,'forged','Motivo')",[customer]),/permission denied/);
  assert.equal(Number(await scalar('select count(*) from customer_access_events')),0,'histórico interno não exposto ao cliente');
  await asUser(viewer);await assert.rejects(db.query("select manage_customer_access($1,$2,'unblock','Liberar teste')",[customer,req]),/Acesso negado/);
  await asUser(admin);await db.query("select manage_customer_access($1,$2,'unblock','Revisado pela equipe')",[customer,req]);
  await db.query("select manage_customer_access($1,$2,'unblock','Revisado pela equipe')",[customer,req]);
  assert.equal(Number(await scalar('select count(*) from customer_access_events')),4,'preserva histórico, liberação idempotente');
  assert.equal(await scalar("select actor_id from customer_access_events where kind='unblock'"),admin);
  await asUser(user);assert.equal(await scalar('select current_customer_id()'),customer);assert.equal(Number(await scalar('select warning_count from customer_access_state')),0);
  await db.exec('reset role');
  await db.query("update lots set status='pending_payment',payment_expired_at=null where id=$1",[lots[0]]);
  await db.query("update lots set status='cancelled',payment_expired_at=now() where id=$1",[lots[0]]);
  assert.equal(Number(await scalar('select warning_count from customer_access_state')),0,'mesmo dia não gera outra advertência após recuperação ou liberação');
  await asUser(admin);const manual=crypto.randomUUID();await db.query("select manage_customer_access($1,$2,'warning','Advertência manual')",[customer,manual]);await db.query("select manage_customer_access($1,$2,'warning','Advertência manual')",[customer,manual]);assert.equal(Number(await scalar('select warning_count from customer_access_state')),1);
 }finally{await db.close();}
});
