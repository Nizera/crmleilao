import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const moduleOf=s=>import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
test('catalog requests coalesce and recover after failure',async()=>{
 const saved=globalThis.fetch;let calls=0,resolve;
 globalThis.fetch=()=>{calls++;return new Promise(r=>{resolve=r})};
 try{const m=await moduleOf(compile(await readFile('src/lib/landing-catalog-browser.ts','utf8')));
 const first=m.fetchLandingCatalog(),second=m.fetchLandingCatalog();assert.equal(first,second);assert.equal(calls,1);
 resolve({ok:false});await assert.rejects(first);const third=m.fetchLandingCatalog();assert.equal(calls,2);
 resolve({ok:true,json:async()=>({lots:[],products:[]})});assert.deepEqual(await third,{lots:[],products:[]});
 }finally{globalThis.fetch=saved;}
});
test('website and panel share the requested direct WhatsApp destination',async()=>{
 const group=await moduleOf(compile(await readFile('src/lib/community.ts','utf8')));
 assert.equal(group.COMMUNITY_GROUP_URL,'https://chat.whatsapp.com/BHlJhz6YAF6Aw0l0kx5pwM?s=sh&p=a&iam=2');
 const panel=await readFile('src/components/client/client-bottom-nav.tsx','utf8');assert.match(panel,/COMMUNITY_GROUP_URL as GROUP_URL/);assert.match(panel,/href={GROUP_URL}/);
 const site=await readFile('src/lib/landing-content.ts','utf8');assert.match(site,/COMMUNITY_GROUP_URL as LANDING_GROUP_URL/);
 const tracking=await readFile('src/components/client/store-marketing.tsx','utf8');assert.ok(!tracking.includes('preventDefault'));assert.ok(tracking.includes('new URL(LANDING_GROUP_URL)'));
});
