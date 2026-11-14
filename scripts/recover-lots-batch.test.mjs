import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('recuperação em lote é atômica, reinicia 24h e rejeita seleção insegura', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create role anon;create role authenticated;
   create function public.has_staff_write() returns boolean language sql stable as $$select coalesce(current_setting('test.staff',true),'false')='true'$$;
   create table lots(id uuid primary key,customer_id uuid,status text,charge_id uuid,paid_at timestamptz,shipped_at timestamptz,moved_at timestamptz,pix_paused_at timestamptz,arremate_value numeric,created_at timestamptz default now(),payment_due_at timestamptz,payment_expired_at timestamptz,payment_reminded_at timestamptz,payment_last_warning_at timestamptz,payment_expiry_retry_at timestamptz);
   create table shipment_lots(lot_id uuid);create table lot_items(lot_id uuid,applied boolean);
   select set_config('test.staff','true',false);`);
  await db.exec(await readFile('supabase/migrations/0063_future_lots_only_deadlines.sql','utf8'));
  await db.exec(`create trigger lot_deadline before insert or update on lots for each row execute function set_lot_payment_deadline()`);
  await db.exec(await readFile('supabase/migrations/0087_recover_cancelled_lots_batch.sql','utf8'));
  const customer=crypto.randomUUID(), a=crypto.randomUUID(),b=crypto.randomUUID();
  const insert=async(id,c=customer)=>db.query("insert into lots(id,customer_id,status,arremate_value,payment_due_at,payment_expired_at,pix_paused_at,moved_at)values($1,$2,'cancelled',20,now()-interval '1 day',now(),now(),now())",[id,c]);
  await insert(a);await insert(b);
  const recover=async(ids)=>db.query('select recover_cancelled_lots_batch($1::uuid[]) n',[ids]);
  await db.exec('set role authenticated');
  assert.equal((await recover([a,b])).rows[0].n,2);
  await db.exec('reset role');
  const rows=(await db.query("select *,extract(epoch from(payment_due_at-now())) seconds from lots")).rows;
  for(const r of rows){assert.equal(r.status,'pending_payment');assert.ok(r.seconds>86395&&r.seconds<=86400);for(const field of ['paid_at','shipped_at','moved_at','pix_paused_at','payment_expired_at','payment_reminded_at','payment_last_warning_at','payment_expiry_retry_at'])assert.equal(r[field],null);}
  await assert.rejects(recover([a,b]),/Todos devem estar cancelados/);
  await db.query("update lots set status='cancelled' where id=any($1::uuid[])",[[a,b]]);
  await db.query("update lots set charge_id=gen_random_uuid() where id=$1",[b]);
  await assert.rejects(recover([a,b]),/Nenhum lote foi alterado/);
  assert.equal((await db.query('select status from lots where id=$1',[a])).rows[0].status,'cancelled');
  await db.query('update lots set charge_id=null where id=$1',[b]);
  const other=crypto.randomUUID();await insert(other,crypto.randomUUID());await assert.rejects(recover([a,other]),/mesmo cliente/);
  await assert.rejects(recover([a,a]),/diferentes/);await assert.rejects(recover([]),/diferentes/);await assert.rejects(recover([a,crypto.randomUUID()]),/não foi encontrado/);
  await db.query('insert into shipment_lots values($1)',[b]);await assert.rejects(recover([a,b]),/vinculado a envio/);await db.exec('delete from shipment_lots');
  await db.query('insert into lot_items values($1,true)',[b]);await assert.rejects(recover([a,b]),/estoque movimentado/);await db.exec('delete from lot_items');
  await db.exec("select set_config('test.staff','false',false);set role authenticated");await assert.rejects(recover([a,b]),/Acesso negado/);
  await db.exec('reset role;set role anon');await assert.rejects(recover([a,b]),/permission denied/);
 } finally { await db.close(); }
});
