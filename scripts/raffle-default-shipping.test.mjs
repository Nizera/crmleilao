import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const release=await readFile('supabase/releases/raffle_default_shipping_date.sql','utf8');
test('premios sem previsao seguem agenda de envio; reparo preserva etiquetas, movimento e datas explicitas',async()=>{
 const db=new PGlite();const id=()=>crypto.randomUUID();
 const scalar=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role;
   create table app_settings(id boolean primary key default true,shipping_weekday int);insert into app_settings(shipping_weekday)values(2);
   create table raffle_campaigns(id uuid primary key,title text,total_numbers int,shipping_date date,created_by uuid);
   create table raffle_prizes(id uuid primary key,campaign_id uuid,title text);
   create table raffle_orders(id uuid primary key,campaign_id uuid,customer_id uuid,status text,numbers int[]);
   create table logistics_pending(id uuid primary key default gen_random_uuid(),customer_id uuid,title text,quantity int,reason text,shipping_date date,created_by uuid,source_kind text,created_at timestamptz default now(),updated_at timestamptz default now(),moved_at timestamptz,shipment_id uuid,cancelled_at timestamptz);
   create table raffle_awards(id uuid primary key default gen_random_uuid(),prize_id uuid unique,campaign_id uuid,order_id uuid,customer_id uuid,number int,logistics_id uuid,result_note text,evidence_url text);
   create table lots(id int,arremate_value numeric);insert into lots values(1,200);`);
  const campaign=id(),explicit=id(),customer=id(),order=id();
  await db.query("insert into raffle_campaigns values($1,'Sem previsao',100,null,null),($2,'Data explicita',100,'2026-11-19',null)",[campaign,explicit]);
  await db.query("insert into raffle_orders values($1,$2,$3,'paid',array[1])",[order,campaign,customer]);
  const cases=[{}, {moved:true}, {shipment:true}, {cancelled:true}, {explicit:true}, {manual:true}, {replacement:true}, {differentCreation:true}, {edited:true}];const ids=[];
  for(const c of cases){const p=id(),a=id();ids.push(p);
   await db.query("insert into logistics_pending(id,customer_id,shipping_date,source_kind,created_at,moved_at,shipment_id,cancelled_at)values($1,$2,$3,$4,$5,$6,$7,$8)",[p,customer,c.manual?'2026-11-20':'2026-11-19',c.replacement?'replacement':'raffle',c.differentCreation?'2026-11-18T12:00:00Z':'2026-11-19T12:00:00Z',c.moved?'2026-11-19T13:00:00Z':null,c.shipment?id():null,c.cancelled?'2026-11-19T13:00:00Z':null]);
   await db.query('insert into raffle_awards(id,prize_id,campaign_id,order_id,customer_id,number,logistics_id)values($1,$2,$3,$4,$5,1,$6)',[a,id(),c.explicit?explicit:campaign,order,customer,p]);
   await db.query("update logistics_pending set updated_at=created_at+case when $2 then interval '1 hour'else interval '0' end where id=$1",[p,Boolean(c.edited)]);
  }
  await db.exec(release);
  assert.equal(await scalar("select shipping_date::text from logistics_pending where id=$1",[ids[0]]),'2026-11-24');
  for(let i=1;i<ids.length;i++)assert.equal(await scalar('select shipping_date::text from logistics_pending where id=$1',[ids[i]]),cases[i].manual?'2026-11-20':'2026-11-19');
  await db.exec(release);assert.equal(await scalar('select count(*)::int from logistics_pending'),9,'reaplicar nao duplica nem altera mais itens');
  const prize=id();await db.query("insert into raffle_prizes values($1,$2,'Premio novo')",[prize,campaign]);
  await db.query('select materialize_raffle_award($1,$2,1)',[prize,order]);
  assert.equal(await scalar("select shipping_date=public.next_shipping_date((now()at time zone 'America/Sao_Paulo')::date)from logistics_pending where id=(select logistics_id from raffle_awards where prize_id=$1)",[prize]),true);
  await db.query('select materialize_raffle_award($1,$2,1)',[prize,order]);assert.equal(await scalar('select count(*)::int from logistics_pending'),10);
  assert.equal(await scalar("select public.next_shipping_date('2026-11-24')::text"),'2026-12-01','premio conquistado na terca segue proxima terca');
  await db.exec('update app_settings set shipping_weekday=3');assert.equal(await scalar("select public.next_shipping_date('2026-11-19')::text"),'2026-11-25');
  const explicitPrize=id(),explicitOrder=id();await db.query("insert into raffle_prizes values($1,$2,'Com previsao')",[explicitPrize,explicit]);await db.query("insert into raffle_orders values($1,$2,$3,'paid',array[1])",[explicitOrder,explicit,customer]);
  await db.query('select materialize_raffle_award($1,$2,1)',[explicitPrize,explicitOrder]);assert.equal(await scalar('select shipping_date::text from logistics_pending where id=(select logistics_id from raffle_awards where prize_id=$1)',[explicitPrize]),'2026-11-19');
  await db.query("update raffle_orders set status='review'where id=$1",[order]);const blocked=id();await db.query("insert into raffle_prizes values($1,$2,'Sem pagamento')",[blocked,campaign]);await assert.rejects(db.query('select materialize_raffle_award($1,$2,1)',[blocked,order]),/pagamento/);
  assert.equal(Number(await scalar('select sum(arremate_value)from lots')),200);
  await db.exec('set role authenticated');await assert.rejects(db.query('select materialize_raffle_award($1,$2,1)',[prize,order]),/permission denied/);
 }finally{await db.close();}
});
