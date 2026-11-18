import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
const rules=await import(url(compile(await readFile('src/lib/landing-live.ts','utf8'))));
test('new lots: no initial/repeated/old notifications; multiple arrivals remain visible',()=>{
 const lot=(id,date)=>({id,title:id,image:null,created_at:date});
 const old=lot('old','2026-11-18T12:00:00Z'),fresh=lot('fresh','2026-11-18T13:00:00Z');
 assert.deepEqual(rules.newLandingLots([old],[fresh,old],new Set(['old']),old.created_at),[fresh]);
 assert.deepEqual(rules.newLandingLots([old],[fresh,old],new Set(['old','fresh']),old.created_at),[]);
 assert.deepEqual(rules.newLandingLots([],[old],new Set(),'2026-11-18T14:00:00Z'),[]);
});
test('public projection: no customer, payments, drafts or internal notes in response',async()=>{
 let selection='',filters=[];
 const query={select(v){selection=v;return this},neq(...v){filters=v;return this},order(){return this},limit(){return Promise.resolve({data:[{id:'lot',title:'Messi',images:['photo.webp'],created_at:'2026-11-18',customer_id:'secret',notes:'private',arremate_value:900}]})}};
 globalThis.__landingMock={from:()=>query,rpc:async(name,args)=>{assert.equal(name,'get_public_store_catalog');assert.equal(args.p_available,true);return {data:{items:[{id:'product',name:'Messi',image_path:'real.webp',category:'Legends',cash_price:10,points_cost:null,stock:1,description:'private extra'}]}}}};
 let source=compile(await readFile('src/lib/landing-live-server.ts','utf8'));
 source=source.replace(/import ['"]server-only['"];?/,'').replace(/import .*?from ['"]@\/lib\/supabase\/admin['"];?/, 'const createAdminClient=()=>globalThis.__landingMock;').replace(/import .*?from ['"]@\/lib\/lots['"];?/, 'const lotImageUrl=p=>p?"https://example.invalid/"+p:null;').replace(/import .*?from ['"]@\/lib\/store['"];?/, 'const priceLabel=(cash)=>String(cash);').replace(/from ['"]@\/lib\/landing-live['"]/, 'from '+JSON.stringify(url(compile(await readFile('src/lib/landing-live.ts','utf8')))));
 try{const m=await import(url(source));const data=await m.loadLandingSnapshot();assert.equal(selection,'id,title,images,created_at');assert.deepEqual(filters,['status','cancelled']);assert.deepEqual(Object.keys(data.lots[0]).sort(),['created_at','id','image','title']);assert.equal(data.products[0].image,'https://example.invalid/real.webp');assert.ok(!JSON.stringify(data).includes('secret'));assert.ok(!JSON.stringify(data).includes('private'));}finally{delete globalThis.__landingMock;}
});
