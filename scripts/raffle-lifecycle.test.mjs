import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadCommerceDb,migration} from './fixtures/commerce-db.mjs';
test('Campanhas: arquivar, restaurar e excluir com histórico protegido',async t=>{
 const db=new PGlite(),actor=crypto.randomUUID();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const draft=()=>v("insert into raffle_campaigns(title,description,total_numbers,unit_price,selection_mode,draw_method,draw_rules,created_by,max_quantity) values('Fixture','Regulamento de teste',10,10,'both','external','Sorteio externo',$1,10) returning id",[actor]);
 const act=(id,action)=>db.query('select raffle_campaign_lifecycle($1,$2)',[id,action]);
 try{
  await loadCommerceDb(db);await db.exec(await migration('0049_raffle_archive_delete.sql'));
  await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into admin_profiles values($1,'owner')",[actor]);await db.query("select set_config('test.actor',$1,false)",[actor]);await db.exec("select set_config('test.admin','true',false)");
  await t.test('arquivar interrompe vendas; repetir não duplica evento; restaurar mantém pausa',async()=>{
   const c=await draft();await db.query("update raffle_campaigns set status='open' where id=$1",[c]);await act(c,'archive');await act(c,'archive');
   assert.equal(await v('select status from raffle_campaigns where id=$1',[c]),'paused');assert.ok(await v('select archived_at from raffle_campaigns where id=$1',[c]));
   await assert.rejects(db.query("update raffle_campaigns set status='open' where id=$1",[c]),/Restaure/);
   await act(c,'restore');assert.equal(await v('select archived_at from raffle_campaigns where id=$1',[c]),null);assert.equal(await v('select status from raffle_campaigns where id=$1',[c]),'paused');
   assert.equal(Number(await v('select count(*) from raffle_campaign_lifecycle_events where campaign_id=$1',[c])),2);
  });
  await t.test('dono exclui rascunho sem reservas e mantém auditoria independente',async()=>{
   const c=await draft();await db.query("insert into raffle_prizes(campaign_id,title,kind) values($1,'Prêmio','main')",[c]);await act(c,'delete');
   assert.equal(Number(await v('select count(*) from raffle_campaigns where id=$1',[c])),0);assert.equal(await v('select action from raffle_campaign_lifecycle_events where campaign_id=$1',[c]),'delete');
  });
  await t.test('qualquer reserva, inclusive cancelada, impede exclusão e arquivo preserva pedido',async()=>{
   const c=await draft(),customer=crypto.randomUUID();await db.query("insert into customers(id,email) values($1,'test@example.invalid')",[customer]);
   await db.query("insert into raffle_orders(campaign_id,customer_id,request_key,amount,numbers,status) values($1,$2,gen_random_uuid(),10,array[0],'cancelled')",[c,customer]);
   await assert.rejects(act(c,'delete'),/Só é possível excluir/);await act(c,'archive');assert.equal(Number(await v('select count(*) from raffle_orders where campaign_id=$1',[c])),1);
  });
  await t.test('staff não exclui; cliente/viewer não arquiva nem escreve auditoria',async()=>{
   const c=await draft();await db.query("update admin_profiles set role='staff' where id=$1",[actor]);await assert.rejects(act(c,'delete'),/Somente o dono/);
   await db.exec("set role authenticated;select set_config('test.admin','false',false)");await assert.rejects(act(c,'archive'),/Acesso negado/);await assert.rejects(db.query("insert into raffle_campaign_lifecycle_events(campaign_id,title,actor,action) values($1,'x',$2,'archive')",[c,actor]),/permission denied/);
  });
 }finally{await db.close();}
});
