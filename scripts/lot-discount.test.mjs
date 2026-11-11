import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { PGlite } from '@electric-sql/pglite';
function load(file,deps={}) { const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console,Error,FormData,File,require:n=>{if(!(n in deps))throw Error('Unexpected '+n);return deps[n];}});return exports; }
const pricing=load('src/lib/lot-pricing.ts');
const lots=load('src/lib/lots.ts',{'zod':{z},'@/lib/dates':{spToday:()=> '2026-11-10'},'@/lib/settings':{DEFAULT_SETTINGS:{},renderTemplate:()=>''}});
const form=(extra={})=>({customer_id:'customer',title:'Lote de teste',arremate_value:'100',discount_amount:'15',status:'pending_payment',auction_date:'2026-11-10',shipping_date:'2026-11-17',...extra});
test('desconto em centavos, formato brasileiro e limites são validados no servidor',()=>{
 assert.deepEqual(JSON.parse(JSON.stringify(pricing.lotPricing('100','15'))),{original:100,discount:15,total:85});
 assert.equal(pricing.lotPricing('0,30','0,10').total,0.2);
 assert.equal(pricing.lotPricing('45').total,45);
 assert.equal(pricing.lotPricing('45','45').total,0);
 for(const d of ['-1','101','NaN','1e2','0.001']) assert.equal(lots.lotSchema.safeParse(form({discount_amount:d})).success,false,d);
 assert.equal(lots.lotSchema.safeParse(form({discount_amount:undefined})).success,true);
});
test('cadastro persiste somente o líquido na cobrança; edição paga passa pela proteção existente',async()=>{
 let saved,guarded=0;
 const db={from(table){return {select(){return this;},eq(){return this;},is(){return this;},insert(row){saved=row;return this;},update(){return this;},single:async()=>({data:{id:'lot',code:'TEST'},error:null}),maybeSingle:async()=>({data:table==='customers'?{id:'customer',name:'Cliente Teste'}:{id:'lot',arremate_value:100,discount_amount:0,customer_id:'customer',status:'paid',paid_at:'2026-11-10',images:[]},error:null}),then(r){return Promise.resolve({data:[],error:null}).then(r);}};},rpc:async()=>({error:null})};
 const {saveLot}=load('src/app/actions/lots.ts',{'zod':{z},'next/cache':{revalidatePath(){},updateTag(){}},'@/lib/dal':{requireAdmin:async()=>({profile:{id:'admin',role:'owner'}}),getAppSettings:async()=>({settings:{shipping_weekday:2}})},'@/lib/phone':{toE164:()=>null},'@/lib/invites-server':{},'@/lib/notes':{saveNote:async()=>{}},'@/lib/result':{rethrowIfRedirect(){}},'@/lib/stock':{parseLotItems:()=>[]},'@/lib/lots':lots,'@/lib/lot-pricing':pricing,'@/lib/supabase/server':{createClient:async()=>db},'@/lib/lot-payment-guard':{prepareLotFinancialChange:async()=>{guarded++;throw Error('Lote já pago: protegido');}}});
 const data=o=>{const f=new FormData();for(const[k,v]of Object.entries(o))f.set(k,v);return f;};
 assert.equal((await saveLot(data(form()))).ok,true);assert.equal(saved.arremate_value,85);assert.equal(saved.discount_amount,15);
 const edit=await saveLot(data(form({id:'lot',status:'paid'})));assert.equal(edit.ok,false);assert.equal(guarded,1);assert.match(edit.error,/protegido/);
});
test('migration mantém lotes antigos sem desconto e rejeita desconto negativo no banco',async()=>{
 const db=new PGlite();try {await db.exec('create table lots(id integer primary key,arremate_value numeric);insert into lots values(1,100)');await db.exec(fs.readFileSync('supabase/migrations/0081_lot_discount.sql','utf8'));assert.equal(Number((await db.query('select discount_amount from lots where id=1')).rows[0].discount_amount),0);await assert.rejects(db.exec('update lots set discount_amount=-1 where id=1'),/check constraint/);}finally{await db.close();}
});
