import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('12h por primeiro leilão, 24h nos demais e histórico preservado; recuperação e avisos',async()=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table customers(id uuid primary key);
   create table lots(id uuid primary key default gen_random_uuid(),customer_id uuid not null references customers,code text default 'TEST',status text default 'pending_payment',arremate_value numeric default 20,auction_date date default current_date,created_at timestamptz default now(),updated_at timestamptz default now(),charge_id uuid,paid_at timestamptz,shipped_at timestamptz,moved_at timestamptz,pix_paused_at timestamptz,payment_due_at timestamptz,payment_expired_at timestamptz,payment_reminded_at timestamptz,payment_last_warning_at timestamptz,payment_expiry_retry_at timestamptz);
   create table charges(id uuid primary key,status text,pix_issue_since timestamptz);
   create table shipments(id uuid primary key,status text);
   create table shipment_lots(lot_id uuid,shipment_id uuid);
   create table lot_items(lot_id uuid,applied boolean);
   create table customer_notifications(customer_id uuid,kind text,title text,body text,href text,dedupe_key text unique);
   create function has_staff_write() returns boolean language sql as $$select true$$;`);
  const old=crypto.randomUUID(),fresh=crypto.randomUUID(),late=crypto.randomUUID();
  for(const id of [old,fresh,late])await db.query('insert into customers values($1)',[id]);
  const oldLot=(await db.query("insert into lots(customer_id,auction_date,payment_due_at)values($1,'2026-11-14',now()+interval '19 hours') returning id,payment_due_at",[old])).rows[0];
  await db.exec(await readFile('supabase/migrations/0063_future_lots_only_deadlines.sql','utf8'));
  await db.exec('create trigger lot_payment_deadline before insert or update on lots for each row execute function set_lot_payment_deadline()');
  await db.exec(await readFile('supabase/migrations/0088_first_auction_payment_terms.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/0087_recover_cancelled_lots_batch.sql','utf8'));
  assert.equal((await db.query('select payment_due_at from lots where id=$1',[oldLot.id])).rows[0].payment_due_at.getTime(),oldLot.payment_due_at.getTime());
  const insert=async(c,day,created=new Date().toISOString())=>(await db.query('insert into lots(customer_id,auction_date,created_at)values($1,$2,$3) returning *,extract(epoch from(payment_due_at-created_at)) hours',[c,day,created])).rows[0];
  const existing=await insert(old,'2026-11-15');assert.equal(existing.payment_term_hours,24);
  const a=await insert(fresh,'2026-11-15','2026-11-16T02:50:00Z');assert.equal(a.payment_term_hours,12);assert.equal(Number(a.hours),43200);
  await db.query("update lots set status='paid',paid_at=now() where id=$1",[a.id]);
  const b=await insert(fresh,'2026-11-15','2026-11-16T03:10:00Z');assert.equal(b.payment_term_hours,12,'mesmo leilão, mesmo após meia-noite e primeiro pago');
  const next=await insert(fresh,'2026-11-16');assert.equal(next.payment_term_hours,24);assert.equal(Number(next.hours),86400);
  await db.query("update lots set status='cancelled' where id=$1",[b.id]);
  await db.query('select recover_cancelled_lots_batch($1::uuid[])',[[b.id]]);
  const recovered=(await db.query('select *,extract(epoch from(payment_due_at-now())) seconds from lots where id=$1',[b.id])).rows[0];assert.equal(recovered.payment_term_hours,12);assert.ok(Number(recovered.seconds)>43195&&Number(recovered.seconds)<=43200);
  await db.query('update lots set auction_date=$2 where id=$1',[b.id,'2026-11-20']);assert.equal((await db.query('select payment_due_at from lots where id=$1',[b.id])).rows[0].payment_due_at.getTime(),recovered.payment_due_at.getTime());
  await db.query('delete from lots where customer_id=$1',[fresh]);assert.equal((await insert(fresh,'2026-11-17')).payment_term_hours,24,'primeiro leilão não reinicia ao apagar histórico');
  const reminder=await insert(late,'2026-11-15',new Date(Date.now()-7*3600000).toISOString());
  await db.exec('select notify_auction_payment_deadlines()');
  const notices=(await db.query('select body from customer_notifications where customer_id=$1',[late])).rows;assert.equal(notices.length,1);assert.ok(!notices[0].body.includes('24h'));
  await db.query("update lots set payment_due_at=now()-interval '1 minute' where id=$1",[reminder.id]);
  assert.equal((await db.query('select expire_unpaid_auction_lot($1) done',[reminder.id])).rows[0].done,true);
  const expired=(await db.query("select body from customer_notifications where customer_id=$1 and kind='lot_payment_expired'",[late])).rows[0];assert.match(expired.body,/12h/);
 }finally{await db.close();}
});
