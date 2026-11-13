import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {PGlite} from '@electric-sql/pglite';
const sql=name=>readFile('supabase/migrations/'+name,'utf8');
test('movimentação real: sem estoque, baixa única, permissões e rollback de seleção inválida',async()=>{
 const db=new PGlite();const id=()=>crypto.randomUUID();const a=id(),b=id(),c=id(),sku=id(),player=id();
 const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function has_staff_write() returns boolean language sql stable as $$select coalesce(current_setting('test.staff',true),'false')='true'$$;
 create type public.stock_move_kind as enum('lot_pick','lot_return','manual_adjust');
 create table lots(id uuid primary key,status text,shipping_date date);
 create table stock_items(id uuid primary key,player_id uuid,color text,qty_on_hand int);
 create table lot_items(lot_id uuid,stock_item_id uuid,player_id uuid,color text,qty int,applied boolean,primary key(lot_id,stock_item_id));
 create table stock_movements(id serial primary key,stock_item_id uuid,delta int,kind public.stock_move_kind,lot_id uuid,created_by uuid);
 grant usage on schema public,auth to authenticated;grant all on all tables in schema public to authenticated;grant usage,select on all sequences in schema public to authenticated;`);
 const stock=await sql('0003_stock.sql');const start=stock.indexOf('create or replace function public.reconcile_lot_items(');await db.exec(stock.slice(start,stock.indexOf('-- ---------------------------------------------------------------------------\n-- Seed explícito',start)));
 await db.exec(await sql('0021_lot_movement_workflow.sql'));
 await db.query("insert into lots(id,status) values($1,'paid'),($2,'paid'),($3,'pending_payment')",[a,b,c]);
 await db.query("insert into stock_items values($1,$2,'dourada',10)",[sku,player]);await db.query("insert into lot_items values($1,$2,$3,'dourada',2,false)",[b,sku,player]);
 await db.exec("set role authenticated;select set_config('test.staff','true',false)");
 assert.equal(await scalar('select move_lots_to_customer_boxes($1)',[[a]]),1);assert.ok(await scalar('select moved_at from lots where id=$1',[a]));
 assert.equal(await scalar('select count(*)::int from stock_movements'),0);
 await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[b]]),/stock_move_kind/,'reproduz incompatibilidade do caminho de busca com estoque');
 await db.exec('reset role');await db.exec(await sql('0083_lot_movement_stock_type.sql'));await db.exec(await sql('0083_lot_movement_stock_type.sql'));
 await db.exec("set role authenticated;select set_config('test.staff','false',false)");await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[b]]),/Acesso negado/);
 await db.exec("select set_config('test.staff','true',false)");
 await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[b,c]]),/não estão disponíveis/);assert.equal(await scalar('select qty_on_hand from stock_items where id=$1',[sku]),10);
 assert.equal(await scalar('select move_lots_to_customer_boxes($1)',[[b]]),1);assert.equal(await scalar('select qty_on_hand from stock_items where id=$1',[sku]),8);assert.equal(await scalar('select count(*)::int from stock_movements'),1);assert.ok(await scalar('select moved_at from lots where id=$1',[b]));
 await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[b]]),/não estão disponíveis/);assert.equal(await scalar('select qty_on_hand from stock_items where id=$1',[sku]),8);
 const legacy=id();await db.exec('reset role');await db.query("insert into lots(id,status) values($1,'paid')",[legacy]);await db.query("insert into lot_items values($1,$2,$3,'dourada',3,true)",[legacy,sku,player]);await db.exec('set role authenticated');
 assert.equal(await scalar('select move_lots_to_customer_boxes($1)',[[legacy]]),1);assert.equal(await scalar('select qty_on_hand from stock_items where id=$1',[sku]),8,'baixa antiga já aplicada não é repetida');assert.equal(await scalar('select count(*)::int from stock_movements'),1);
 await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[c,c]]),/duplicados/);
 await db.exec('reset role');await db.query("update lots set status='shipped' where id=$1",[c]);await db.exec('set role authenticated');await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[c]]),/não estão disponíveis/);
 await db.exec('reset role;set role anon');await assert.rejects(db.query('select move_lots_to_customer_boxes($1)',[[c]]),/permission denied/);
 }finally{await db.close();}
});
