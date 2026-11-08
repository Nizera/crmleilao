import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const source=ts.transpileModule(fs.readFileSync('src/lib/raffle-number-states.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {expandRaffleNumberStates}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));

test('monta todas as cotas e mantém bloqueios além da primeira centena',()=>{
 const numbers=expandRaffleNumberStates({total:1000,occupied:[{number:0,state:'paid'},{number:583,state:'reserved'},{number:999,state:'paid'}]},1000);
 assert.equal(numbers.length,1000);assert.equal(numbers[0].state,'paid');assert.equal(numbers[582].state,'available');assert.equal(numbers[583].state,'reserved');assert.equal(numbers[999].state,'paid');
 assert.equal(expandRaffleNumberStates({total:10000,occupied:[]},10000).at(-1).number,9999);
 for(const snapshot of [{total:1000,occupied:[{number:1000,state:'paid'}]},{total:1000,occupied:[{number:1,state:'available'}]},{total:1000,occupied:[{number:2,state:'paid'},{number:2,state:'reserved'}]},{total:999,occupied:[]}])assert.throws(()=>expandRaffleNumberStates(snapshot,1000));
});

test('consulta pública expõe só estados; rascunhos e campanhas arquivadas ficam protegidos',async()=>{
 const db=new PGlite();const id='11111111-1111-4111-8111-111111111111';
 try{
  await db.exec(`create role anon;create role authenticated;
   create function public.is_admin() returns boolean language sql as $$select coalesce(current_setting('test.admin',true),'no')='yes'$$;
   create table public.raffle_campaigns(id uuid primary key,status text,total_numbers integer,archived_at timestamptz);
   create table public.raffle_orders(id uuid primary key,campaign_id uuid,status text);
   create table public.raffle_allocations(campaign_id uuid,number integer,order_id uuid);
   insert into public.raffle_campaigns values('${id}','open',1000,null);
   insert into public.raffle_orders values('22222222-2222-4222-8222-222222222222','${id}','paid'),('33333333-3333-4333-8333-333333333333','${id}','pending');
   insert into public.raffle_allocations values('${id}',583,'22222222-2222-4222-8222-222222222222'),('${id}',999,'33333333-3333-4333-8333-333333333333');`);
  await db.exec(fs.readFileSync('supabase/migrations/0070_raffle_number_states.sql','utf8'));
  const read=async()=>(await db.query('select public.get_public_raffle_number_states($1) snapshot',[id])).rows[0].snapshot;
  assert.deepEqual(await read(),{total:1000,occupied:[{number:583,state:'paid'},{number:999,state:'reserved'}]});
  await db.exec("update public.raffle_campaigns set status='draft'");await assert.rejects(read,/não encontrada/);
  await db.exec("set test.admin='yes'");assert.equal((await read()).total,1000);
  await db.exec("set test.admin='no';update public.raffle_campaigns set status='open',archived_at=now()");await assert.rejects(read,/não encontrada/);
  assert.equal((await db.query("select has_function_privilege('anon','public.get_public_raffle_number_states(uuid)','execute') allowed")).rows[0].allowed,true);
 }finally{await db.close();}
});
