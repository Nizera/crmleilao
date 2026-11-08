import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const module={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/raffle-awards-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:module});
const {raffleAwardsSignature}=module;
test('detecta um novo prêmio e mudanças de entrega sem depender de foto ou nome',()=>{
 const old=[{id:'main',order_status:'paid'}];
 assert.notEqual(raffleAwardsSignature(old),raffleAwardsSignature([...old,{id:'instant',order_status:'paid'}]));
 assert.notEqual(raffleAwardsSignature(old),raffleAwardsSignature([{...old[0],cancelled_at:'2026-11-08'}]));
 assert.notEqual(raffleAwardsSignature(old),raffleAwardsSignature([{...old[0],moved_at:'2026-11-08'}]));
 assert.equal(raffleAwardsSignature(old),raffleAwardsSignature([{...old[0],name:'nome alterado',photos:['https://private.example/image']}])) ;
});
test('a consulta só retorna assinatura dos próprios prêmios e exige sessão',async()=>{
 let loggedIn=true,calls=0;
 const deps={'@/lib/dal':{requireCustomer:async()=>{if(!loggedIn)throw Error('no session');return {customer:{id:'owner'}};}},'@/lib/supabase/server':{createClient:async()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'get_raffle_awards');assert.equal(args.p_page,1);return {data:[{id:'mine',customer_id:'owner',title:'prêmio particular'},{id:'foreign',customer_id:'someone-else'}],error:null};}})},'@/lib/result':{rethrowIfRedirect(){}},'@/lib/raffle-awards-state':{raffleAwardsSignature}};
 const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/app/actions/raffle-awards-state.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:api,require:name=>deps[name]});
 const result=await api.readSelfRaffleAwardsState(1);
 assert.equal(result.ok,true);assert.match(result.data.signature,/mine/);assert.doesNotMatch(result.data.signature,/foreign|particular/);
 assert.equal((await api.readSelfRaffleAwardsState(-1)).ok,false);
 loggedIn=false;assert.equal((await api.readSelfRaffleAwardsState(1)).ok,false);assert.equal(calls,1);
});
