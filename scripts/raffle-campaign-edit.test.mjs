import {test} from 'node:test';import assert from 'node:assert/strict';import {PGlite} from '@electric-sql/pglite';import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('edição de campanha valida concorrência, reservas, promoções e mantém pagamentos intactos',async()=>{
 const db=new PGlite(),actor=crypto.randomUUID(),customer=crypto.randomUUID(),campaign=crypto.randomUUID();
 try{
 await loadCommerceDb(db);
 await db.exec(`alter table raffle_campaigns add column image_urls text[] not null default '{}',add column price_tiers jsonb not null default '[]',add column archived_at timestamptz;
 create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;`);
 const promo=await migration('0071_raffle_quantity_promotions.sql');await db.exec(promo.slice(promo.indexOf('create function public.set_raffle_price_tiers('),promo.indexOf('create function public.save_raffle_campaign_with_promotions(')));
 await db.exec(await migration('0090_edit_raffle_campaign.sql'));
 await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
 await db.query(`insert into raffle_campaigns(id,title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,shipping_date,image_url,hide_winning_numbers,min_quantity,max_quantity,status,created_by)
 values($1,'Campanha original','Descrição da campanha original',100,10,'both','external','Regra da apuração original',null,'',true,1,20,'draft',$2)`,[campaign,actor]);
 const snapshot=async()=>(await db.query('select to_jsonb(c) data from raffle_campaigns c where id=$1',[campaign])).rows[0].data;
 const edit=(patch,expected)=>db.query('select edit_raffle_campaign($1,$2::jsonb,$3::jsonb)',[campaign,JSON.stringify({...expected,...patch}),JSON.stringify(expected)]);
 let old=await snapshot();await edit({title:'Nova campanha',unit_price:12,total_numbers:120,description:'Descrição revisada da campanha'},old);let current=await snapshot();assert.equal(current.title,'Nova campanha');assert.equal(current.unit_price,12);assert.equal(current.total_numbers,120);assert.equal(current.status,'draft');
 await assert.rejects(edit({title:'Concorrente'},old),/campanha mudou/);
 await db.query("insert into raffle_prizes(campaign_id,title,kind,number)values($1,'Cota especial','instant',110)",[campaign]);
 await assert.rejects(edit({total_numbers:100},current),/cotas premiadas fora/);assert.equal((await snapshot()).total_numbers,120);
 await db.query("update raffle_campaigns set price_tiers='[{\"min_quantity\":5,\"unit_price\":8}]' where id=$1",[campaign]);current=await snapshot();await assert.rejects(edit({unit_price:7},current),/Revise as quantidades/);assert.equal((await snapshot()).unit_price,12);
 await db.query('insert into customers(id,name) values($1,$2)',[customer,'Cliente']);const order=crypto.randomUUID();
 await db.query("insert into raffle_orders(id,campaign_id,customer_id,request_key,amount,numbers,status)values($1,$2,$3,gen_random_uuid(),12,array[1],'pending')",[order,campaign,customer]);
 current=await snapshot();await assert.rejects(edit({unit_price:15},current),/reservas pendentes/);
 await edit({title:'Título corrigido'},current);current=await snapshot();await assert.rejects(edit({total_numbers:121},current),/primeira reserva/);
 await db.query("update raffle_orders set status='paid' where id=$1",[order]);await edit({unit_price:15},current);assert.equal(Number((await db.query('select amount from raffle_orders where id=$1',[order])).rows[0].amount),12);
 await db.query("update raffle_campaigns set status='open' where id=$1",[campaign]);await assert.rejects(edit({title:'Não permitido'},await snapshot()),/pause/);
 await db.query("update raffle_campaigns set status='closed' where id=$1",[campaign]);await assert.rejects(edit({title:'Não permitido'},await snapshot()),/pause/);
 await db.query("update raffle_campaigns set status='paused' where id=$1",[campaign]);current=await snapshot();await edit({description:'Descrição após pausa permitida'},current);
 await db.exec("set role authenticated;select set_config('test.readonly','true',false)");await assert.rejects(edit({title:'Sem acesso'},await snapshot()),/Acesso negado/);
 }finally{await db.close();}
});
