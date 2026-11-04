import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const load=(file,deps,env={})=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>deps[n]??{},process:{env},URL,console});return exports;};
test('webhook recusa localhost/HTTP e aceita destino HTTPS explícito',()=>{
 const env={NEXT_PUBLIC_SITE_URL:'http://localhost:3000'};
 const sf=load('src/lib/superfrete.ts',{'@/lib/lots':{siteUrl:()=>env.NEXT_PUBLIC_SITE_URL}},env);
 assert.throws(()=>sf.sfWebhookUrl(),/URL pública HTTPS/);
 for(const url of ['https://localhost/hook','https://127.0.0.1/hook','https://192.168.0.2/hook','http://www.oscarasdaslegends.com.br/hook']){env.SUPERFRETE_WEBHOOK_URL=url;assert.throws(()=>sf.sfWebhookUrl());}
 env.SUPERFRETE_WEBHOOK_URL='https://www.oscarasdaslegends.com.br/api/webhooks/superfrete';assert.equal(sf.sfWebhookUrl(),env.SUPERFRETE_WEBHOOK_URL);
});
test('notificações são gravadas e eventos concorrentes não duplicam com índice parcial real',async()=>{
 const db=new PGlite();
 try{
 await db.exec(`create table customer_notifications(customer_id text,kind text,title text,body text,href text,dedupe_key text); create unique index customer_notifications_dedupe_idx on customer_notifications(customer_id,dedupe_key) where dedupe_key is not null;`);
 const api={from:()=>({insert:async row=>{try{const entries=Object.entries(row);await db.query('insert into customer_notifications('+entries.map(([k])=>k).join(',')+') values('+entries.map((_,i)=>'$'+(i+1)).join(',')+')',entries.map(([,v])=>v));return {error:null};}catch(e){return {error:{code:e.code,message:e.message}};}}})};
 const {notifyCustomer}=load('src/lib/notifications-server.ts',{'@/lib/supabase/admin':{createAdminClient:()=>api}});
 const msg={customerId:'a',kind:'shipment_posted',title:'Envio postado',dedupeKey:'shipment_posted:test'};
 await Promise.all([notifyCustomer(msg),notifyCustomer(msg)]);
 assert.equal((await db.query('select count(*)::int n from customer_notifications')).rows[0].n,1);
 await notifyCustomer({...msg,customerId:'b'});
 assert.equal((await db.query('select count(*)::int n from customer_notifications')).rows[0].n,2);
 }finally{await db.close();}
});
