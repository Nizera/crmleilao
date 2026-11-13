import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('separação após etiqueta preserva conteúdo e valor; ações destrutivas e acesso indevido bloqueados',async()=>{
 const db=new PGlite();
 const id=()=>crypto.randomUUID();const customer=id(),shipment=id(),replacement=id(),prize=id(),order=id();
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
 create function public.has_staff_write() returns boolean language sql as $$select current_setting('test.staff',true)='true'$$;
 create table shipments(id uuid primary key,customer_id uuid,status text,content_snapshot jsonb);
 create table logistics_pending(id uuid primary key,customer_id uuid,source_kind text,shipment_id uuid,cancelled_at timestamptz,cancelled_by uuid,moved_at timestamptz,moved_by uuid,shipping_date date,shipping_declared_value numeric);
 create table raffle_orders(id uuid primary key,status text);
 create table raffle_awards(logistics_id uuid,order_id uuid);`);
 await db.exec(await readFile('supabase/migrations/0082_box_linked_logistics.sql','utf8'));
 await db.exec(await readFile('supabase/migrations/0082_box_linked_logistics.sql','utf8'));
 await db.query("insert into shipments values($1,$2,'released','{\"frozen\":true}')",[shipment,customer]);
 for(const [issue,kind] of [[replacement,'replacement'],[prize,'raffle']])await db.query("insert into logistics_pending(id,customer_id,source_kind,shipment_id,shipping_declared_value) values($1,$2,$3,$4,15)",[issue,customer,kind,shipment]);
 await db.query("insert into raffle_orders values($1,'paid')",[order]);await db.query('insert into raffle_awards values($1,$2)',[prize,order]);
 await db.exec("set role authenticated;select set_config('test.staff','false',false)");
 await assert.rejects(db.query("select handle_logistics_pending($1,'box')",[replacement]),/Acesso negado/);
 await assert.rejects(db.query('select box_raffle_award($1,0)',[prize]),/Acesso negado/);
 await db.exec("select set_config('test.staff','true',false)");
 await db.query("select handle_logistics_pending($1,'box')",[replacement]);await db.query('select box_raffle_award($1,999)',[prize]);
 for(const action of ['cancel','reopen','reschedule'])await assert.rejects(db.query('select handle_logistics_pending($1,$2,current_date)',[replacement,action]),/etiqueta/);
 await db.exec('reset role');
 const rows=(await db.query('select * from logistics_pending')).rows;assert.ok(rows.every(r=>r.moved_at));assert.ok(rows.every(r=>Number(r.shipping_declared_value)===15&&r.shipment_id===shipment));
 assert.deepEqual((await db.query('select content_snapshot from shipments')).rows[0].content_snapshot,{frozen:true});
 const moved=rows.find(r=>r.id===prize).moved_at;
 await db.exec("set role authenticated");await db.query('select box_raffle_award($1,0)',[prize]);await db.exec('reset role');assert.equal((await db.query('select moved_at from logistics_pending where id=$1',[prize])).rows[0].moved_at.getTime(),moved.getTime());
 await db.query("update raffle_orders set status='review'");await assert.rejects(db.query('select box_raffle_award($1,0)',[prize]),/pagamento/);
 await db.query("update shipments set status='cancelled'");await assert.rejects(db.query("select handle_logistics_pending($1,'box')",[replacement]),/situação da etiqueta/);
 }finally{await db.close();}
});
