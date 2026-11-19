import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';

test('controles administrativos: vouchers reconciliados, histórico paginado e ranking completo privado',async t=>{
 const db=new PGlite(),actor=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID(),c=crypto.randomUUID(),d=crypto.randomUUID();
 const v=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
 const sql=await readFile('supabase/releases/admin_voucher_ranking.sql','utf8');
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
   create function public.is_admin()returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'false')='true'$$;
   grant usage on schema public,auth to anon,authenticated;
   create table customers(id uuid primary key,name text,phone_e164 text,loyalty_rank_visible boolean);
   create table loyalty_settings(id boolean,active boolean,ranking_enabled boolean);
   create table loyalty_rank_history(customer_id uuid,rank_points numeric);
   create table loyalty_ledger(customer_id uuid,points numeric,kind text,note text);
   create table raffle_campaigns(id uuid primary key,title text);
   create table raffle_buyer_results(campaign_id uuid primary key,status text);
   create table auction_vouchers(id uuid primary key,campaign_id uuid,customer_id uuid,title text,amount numeric,remaining numeric,created_at timestamptz default now());
   create table lots(id uuid primary key,code text,title text,status text,arremate_value numeric,voucher_amount numeric,auction_voucher_id uuid,created_at timestamptz default now());
   create table auction_voucher_movements(id uuid primary key default gen_random_uuid(),voucher_id uuid,lot_id uuid,delta numeric,created_at timestamptz default now());
   insert into loyalty_settings values(true,true,false);`);
  await db.exec(sql);
  await db.query("select set_config('test.actor',$1,false),set_config('test.admin','true',false)",[actor]);
  for(const [id,name,visible]of [[a,'Cliente Oculto',false],[b,'Cliente Público',true],[c,'Empate Prata',true],[d,'Sem pontos',false]])await db.query("insert into customers values($1,$2,'+5515999999999',$3)",[id,name,visible]);
  await db.query('insert into loyalty_rank_history values($1,500),($2,1000),($3,5000)',[a,b,c]);
  await db.query("insert into loyalty_ledger values($1,250,'earned',null),($1,-50,'reversal',null),($1,-600,'spent',null),($1,100,'adjustment','Recalibração histórica de pontos (migração 0022)'),($2,4000,'earned',null)",[a,b]);
  const ids=[];
  for(const [customer,amount,remaining,status,title]of [[a,100,60,'fulfilled','Rifa A'],[b,50,0,'fulfilled','Rifa B'],[c,80,30,'review','Rifa C'],[a,5,5,'fulfilled','Rifa D']]){
   const campaign=crypto.randomUUID(),id=crypto.randomUUID();ids.push(id);
   await db.query('insert into raffle_campaigns values($1,$2)',[campaign,title]);await db.query('insert into raffle_buyer_results values($1,$2)',[campaign,status]);
   await db.query("insert into auction_vouchers(id,campaign_id,customer_id,title,amount,remaining)values($1,$2,$3,'Voucher de rifa',$4,$5)",[id,campaign,customer,amount,remaining]);
  }
  const lots=[];
  for(const [voucher,status,amount]of [[ids[0],'pending_payment',20],[ids[0],'paid',20],[ids[0],'cancelled',10],[ids[1],'delivered',50],[ids[2],'pending_payment',50]]){
   const id=crypto.randomUUID();lots.push(id);await db.query("insert into lots(id,code,title,status,arremate_value,voucher_amount,auction_voucher_id)values($1,$2,'Lote teste',$3,0,$4,$5)",[id,'L-'+lots.length,status,amount,voucher]);
  }
  await t.test('saldo, pendentes e quitados não duplicam cancelamentos nem clientes com mais de um voucher',async()=>{
   const s=await v('select get_admin_auction_voucher_summary()');assert.deepEqual(s,{issued:235,available:65,reserved:70,used:70,review:30,clients:1,vouchers:4});
   assert.equal(s.issued,s.available+s.reserved+s.used+s.review);
   for(const [status,total]of [['all',4],['available',2],['reserved',2],['used',2],['review',1]])assert.equal((await v('select get_admin_auction_vouchers(\'\',$1,1)',[status])).total,total);
   assert.equal((await v("select get_admin_auction_vouchers('Rifa C','all',1)")).items[0].status,'review');
   assert.equal((await v("select get_admin_auction_vouchers('Cliente Oculto','all',1)")).items.length,2);
  });
  await t.test('histórico preserva movimentos e lotes cancelados, paginando sem perder registros',async()=>{
   for(let i=0;i<53;i++)await db.query('insert into auction_voucher_movements(voucher_id,lot_id,delta,created_at) values($1,$2,$3,$4)',[ids[0],lots[0],i%2?10:-10,new Date(Date.UTC(2026,10,1,0,i)).toISOString()]);
   const first=await v('select get_admin_auction_voucher_detail($1,1)',[ids[0]]),last=await v('select get_admin_auction_voucher_detail($1,999)',[ids[0]]);
   assert.equal(first.movements.length,25);assert.equal(first.lots.length,3);assert.equal(first.movements_total,53);assert.equal(last.page,3);assert.equal(last.movements.length,3);
   const page2=await v('select get_admin_auction_voucher_detail($1,2)',[ids[0]]);
   assert.equal(new Set([...first.movements,...page2.movements,...last.movements].map(x=>x.id)).size,53);
   assert.equal(await v('select get_admin_auction_voucher_detail($1,1)',[crypto.randomUUID()]),null);
  });
  await t.test('ranking inclui opt-out e zero pontos; usa os mesmos pontos permanentes, com empates globais',async()=>{
   const r=await v('select get_admin_loyalty_ranking()');assert.equal(r.total,4);assert.equal(r.public_enabled,false);
   assert.equal(r.items.find(x=>x.id===a).points,800);assert.equal(r.items.find(x=>x.id===d).points,0);
   assert.equal(r.items.find(x=>x.id===b).position,1);assert.equal(r.items.find(x=>x.id===c).position,1);
   const hidden=await v("select get_admin_loyalty_ranking('Cliente Oculto','all',1)");assert.equal(hidden.items[0].position,3);assert.equal(hidden.items[0].rank_visible,false);
   assert.equal((await v("select get_admin_loyalty_ranking('','prata',1)")).items.length,2);
   for(let i=0;i<27;i++)await db.query("insert into customers values(gen_random_uuid(),$1,'+5515000000000',false)",['Pessoa '+i]);
   const p1=await v('select get_admin_loyalty_ranking()'),p2=await v("select get_admin_loyalty_ranking('','all',2)");
   assert.equal(p1.items.length,25);assert.equal(p2.items.length,6);assert.equal(new Set([...p1.items,...p2.items].map(x=>x.id)).size,31);
   assert.equal((await v("select get_admin_loyalty_ranking('Pessoa 26','all',1)")).total,1);
  });
  await t.test('limites dos seis elos concordam com o cálculo do aplicativo',async()=>{
   const code=ts.transpileModule(await readFile('src/lib/loyalty-tiers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
   const {getLoyaltyTier}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
   for(const points of [999,1000,4999,5000,14999,15000,24999,25000,49999,50000]){
    const id=crypto.randomUUID();await db.query("insert into customers values($1,$2,'+5515000000001',false)",[id,'Limite '+points]);await db.query('insert into loyalty_rank_history values($1,$2)',[id,points]);
    const row=(await v('select get_admin_loyalty_ranking($1,\'all\',1)',['Limite '+points])).items[0];assert.equal(row.tier_key,getLoyaltyTier(points).key);
   }
  });
  await t.test('consultas não alteram saldos e usuários comuns/visitantes não acessam relatórios',async()=>{
   assert.equal(Number(await v('select sum(remaining) from auction_vouchers')),95);
   assert.equal((await v("select get_admin_loyalty_ranking($1,'all',1)",["' OR 1=1 --"])).total,0);
   await assert.rejects(db.query("select get_admin_auction_vouchers('','invalid',1)"),/Filtro inválido/);
   await db.exec("set role authenticated;select set_config('test.admin','false',false)");
   for(const q of ['select get_admin_auction_voucher_summary()','select get_admin_auction_vouchers()','select get_admin_loyalty_ranking()'])await assert.rejects(db.query(q),/Acesso negado/);
   await assert.rejects(db.query('select get_admin_auction_voucher_detail($1)',[ids[0]]),/Acesso negado/);
   await db.exec("select set_config('test.admin','true',false)");assert.equal((await v('select get_admin_auction_vouchers()')).total,4,'equipe pode consultar sem acesso direto às tabelas');
   await db.exec("select set_config('test.actor','',false)");await assert.rejects(db.query('select get_admin_loyalty_ranking()'),/Acesso negado/);
   await db.exec('reset role;set role anon');await assert.rejects(db.query('select get_admin_auction_voucher_summary()'),/permission denied/);
  });
 }finally{await db.close();}
});
