import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';

test('Pix: lease, proteção de prazo, recuperação e permissões no banco',async()=>{
 const db=new PGlite();const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 try{
  await loadCommerceDb(db);
  await db.exec(`alter table lots add column if not exists moved_at timestamptz,add column if not exists paid_at timestamptz,add column if not exists updated_at timestamptz default now();create table if not exists lot_items(lot_id uuid,applied boolean default false);create table customer_notifications(id uuid primary key default gen_random_uuid(),customer_id uuid,kind text,title text,body text,href text,dedupe_key text unique);alter table charges add column mp_payment_id text,add column external_reference text;
   create schema cron;create table cron.job(jobid bigint,jobname text,command text);create function cron.alter_job(job_id bigint,command text) returns void language sql as $$ update cron.job set command=$2 where jobid=$1 $$;
   insert into cron.job values(1,'ocdl-auction-payment-deadlines','select 1 where exists(select 1 from public.lots where status=''pending_payment'' and arremate_value>0 and payment_due_at is not null);');`);
  await db.exec(await migration('0062_auction_payment_deadlines.sql'));
  await db.exec(await migration('0072_auction_pix_recovery.sql'));
  const customer=crypto.randomUUID();await db.query("insert into customers(id,name,email) values($1,'Fixture','fixture@example.invalid')",[customer]);
  const charge=await scalar('insert into charges(customer_id) values($1) returning id',[customer]);
  const lot=await scalar("insert into lots(id,customer_id,code,title,status,arremate_value,auction_date) values(gen_random_uuid(),$1,'PIX-TEST','Fixture','pending_payment',30,current_date) returning id",[customer]);
  await db.query("update lots set charge_id=$1,payment_due_at=now()+interval '1 minute' where id=$2",[charge,lot]);
  assert.equal(await scalar('select claim_charge_pix_attempt($1)',[charge]),true);
  assert.equal(await scalar('select claim_charge_pix_attempt($1)',[charge]),false);
  await scalar("select record_charge_pix_issue($1,'http_402:failed')",[charge]);
  assert.equal(Number(await scalar('select notify_auction_payment_deadlines()')),0,'não avisa cancelamento enquanto o Pix está protegido');
  await db.query("update lots set payment_due_at=now()-interval '2 hours' where id=$1",[lot]);
  assert.equal(Number(await scalar('select count(*) from claim_auction_payment_expirations()')),0);
  assert.equal(Number(await scalar('select notify_auction_payment_deadlines()')),0);
  await assert.rejects(db.query("update lots set status='cancelled',payment_expired_at=now() where id=$1",[lot]),/protegido/);
  await assert.rejects(db.query("select record_charge_pix_issue($1,'payer@example.invalid')",[charge]),/diagnóstico/);
  await db.query("update charges set pix_issue_since=now()-interval '3 hours',pix_last_attempt_at=now()-interval '6 minutes',pix_attempts=4 where id=$1",[charge]);
  assert.equal(await scalar('select claim_charge_pix_attempt($1,true)',[charge]),false);
  assert.equal(await scalar('select claim_charge_pix_attempt($1,false)',[charge]),true);
  await scalar('select resolve_charge_pix_issue($1)',[charge]);
  assert.equal(await scalar('select pix_issue_since from charges where id=$1',[charge]),null);
  const due=await scalar('select payment_due_at from lots where id=$1',[lot]);
  assert.ok(Number(await scalar('select extract(epoch from(payment_due_at-now())) from lots where id=$1',[lot]))>=3590);
  await scalar('select resolve_charge_pix_issue($1)',[charge]);assert.equal(String(await scalar('select payment_due_at from lots where id=$1',[lot])),String(due));
  await scalar("select record_charge_pix_issue($1,'preparing')",[charge]);
  await scalar('select resolve_charge_pix_issue($1)',[charge]);
  assert.equal(String(await scalar('select payment_due_at from lots where id=$1',[lot])),String(due),'preparação normal não dá prazo extra');
  assert.equal(await scalar('select pix_paused_at from lots where id=$1',[lot]),null);
  await db.exec('set role authenticated');await assert.rejects(db.query('select claim_charge_pix_attempt($1)',[charge]),/permission denied/);await assert.rejects(db.query('select resolve_charge_pix_issue($1)',[charge]),/permission denied/);
  await db.exec('reset role');
  const command=await scalar('select command from cron.job where jobid=1');assert.ok(command.includes('pix_attempts<4'));assert.ok(!command.includes('; or'));await db.exec(command);
 }finally{await db.close();}
});
