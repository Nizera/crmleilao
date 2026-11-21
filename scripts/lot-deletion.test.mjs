import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

test('exclusão: valida vínculo financeiro, reverte estoque, audita e impede alterações concorrentes e acesso indevido',async()=>{
 const db=new PGlite(),actor=crypto.randomUUID(),stock=crypto.randomUUID(),player=crypto.randomUUID();
 const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;grant usage on schema public,auth to authenticated,anon;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create function public.is_admin() returns boolean language sql stable as $$select current_setting('test.admin',true)='true'$$;
   create function public.has_staff_write() returns boolean language sql stable as $$select public.is_admin() and coalesce(current_setting('test.readonly',true),'false')<>'true'$$;
   create table admin_profiles(id uuid primary key);
   create table lots(id uuid primary key default gen_random_uuid(),code text default 'TESTE',title text default 'Figurinha',customer_id uuid,status text default 'pending_payment',paid_at timestamptz,shipped_at timestamptz,moved_at timestamptz,charge_id uuid,auction_voucher_id uuid,voucher_amount numeric default 0,updated_at timestamptz default now());
   create table shipment_lots(lot_id uuid references lots(id));
   create table stock_items(id uuid primary key,player_id uuid,color text,qty_on_hand int);
   create table lot_items(lot_id uuid references lots(id) on delete cascade,stock_item_id uuid references stock_items(id),player_id uuid,color text,qty int,applied boolean,primary key(lot_id,stock_item_id));
   create type stock_move_kind as enum('lot_pick','lot_return');
   create table stock_movements(stock_item_id uuid,delta int,kind stock_move_kind,lot_id uuid references lots(id) on delete set null,created_by uuid);`);
  await db.query('insert into admin_profiles values($1)',[actor]);
  await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
  await db.exec(readFileSync('supabase/migrations/0083_lot_movement_stock_type.sql','utf8'));
  await db.exec(readFileSync('supabase/releases/delete_unpaid_lot.sql','utf8'));
  const lot=async()=> (await db.query('insert into lots default values returning id,updated_at::text')).rows[0];
  const remove=row=>db.query('select delete_unpaid_lot($1,$2)',[row.id,row.updated_at]);
  const unpaid=await lot();
  await db.query("insert into stock_items values($1,$2,'bronze',8)",[stock,player]);
  await db.query("insert into lot_items values($1,$2,$3,'bronze',2,true)",[unpaid.id,stock,player]);
  await remove(unpaid);
  assert.equal(await scalar('select qty_on_hand from stock_items where id=$1',[stock]),10);
  assert.equal(await scalar('select count(*)::int from lots where id=$1',[unpaid.id]),0);
  assert.equal(await scalar('select count(*)::int from lot_items where lot_id=$1',[unpaid.id]),0);
  assert.equal(await scalar("select count(*)::int from stock_movements where delta=2 and kind='lot_return' and lot_id is null"),1);
  const audit=(await db.query('select * from lot_deletions where lot_id=$1',[unpaid.id])).rows[0];
  assert.equal(audit.snapshot.status,'pending_payment');assert.equal(audit.items[0].qty,2);assert.equal(audit.deleted_by,actor);
  await assert.rejects(remove(unpaid),/já excluído/);
  for(const [change,message] of [["status='paid'",/pagos/],["paid_at=now()",/pagos/],["status='shipped'",/pagos/],["charge_id=gen_random_uuid()",/cobrança/],["voucher_amount=50",/voucher/],["auction_voucher_id=gen_random_uuid()",/voucher/],["moved_at=now()",/separado/],["shipped_at=now()",/separado/]]){
   const row=await lot();await db.query(`update lots set ${change} where id=$1`,[row.id]);await assert.rejects(remove(row),message);assert.equal(await scalar('select count(*)::int from lots where id=$1',[row.id]),1);
  }
  const shipped=await lot();await db.query('insert into shipment_lots values($1)',[shipped.id]);await assert.rejects(remove(shipped),/envio/);
  const changed=await lot();await db.query("update lots set updated_at=updated_at+interval '1 second' where id=$1",[changed.id]);await assert.rejects(remove(changed),/mudou/);
  const failed=await lot();await db.query("insert into lot_items values($1,$2,$3,'bronze',2,true)",[failed.id,stock,player]);
  await db.exec("create function fail_stock_test()returns trigger language plpgsql as $$begin raise exception 'Falha de estoque simulada';end$$;create trigger fail_stock_test before insert on stock_movements for each row execute function fail_stock_test();");
  await assert.rejects(remove(failed),/Falha de estoque/);
  assert.equal(await scalar('select count(*)::int from lots where id=$1',[failed.id]),1);
  assert.equal(await scalar('select count(*)::int from lot_deletions where lot_id=$1',[failed.id]),0);
  assert.equal(await scalar('select qty_on_hand from stock_items where id=$1',[stock]),10,'stock rollback is atomic');
  await db.exec('drop trigger fail_stock_test on stock_movements;drop function fail_stock_test()');
  const cancelled=await lot();await db.query("update lots set status='cancelled' where id=$1",[cancelled.id]);await remove(cancelled);
  await db.exec("set role authenticated;select set_config('test.readonly','true',false)");await assert.rejects(remove(failed),/Acesso negado/);
  await db.exec("select set_config('test.admin','false',false)");assert.equal(await scalar('select count(*)::int from lot_deletions'),0);
  await db.exec('reset role;set role anon');await assert.rejects(remove(failed),/permission denied/);
 }finally{await db.close();}
});
