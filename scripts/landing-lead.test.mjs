import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const url=s=>'data:text/javascript;base64,'+Buffer.from(s).toString('base64');
test('landing lead: consent, one event per session, correct scope, no navigation dependency',async()=>{
 const saved=Object.fromEntries(['window','document','location','localStorage','sessionStorage'].map(k=>[k,globalThis[k]]));
 const store=new Map(),session=new Map(),scripts=[],calls=[];
 globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,v)};
 globalThis.sessionStorage={getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v)};
 globalThis.window={dispatchEvent(){},addEventListener(){},removeEventListener(){}};
 globalThis.location={pathname:'/',search:'',hostname:'localhost'};
 globalThis.document={createElement:()=>({}),head:{appendChild:s=>scripts.push(s)}};
 try{
  const rules=url(compile(await readFile('src/lib/meta-commerce.ts','utf8')));
  const source=compile(await readFile('src/lib/meta-browser.ts','utf8')).replace(/from ['"]@\/lib\/meta-commerce['"]/,'from '+JSON.stringify(rules));
  const m=await import(url(source));
  m.enableStorePixel('1074294225103386',true);m.trackLandingLead('hero');assert.equal(scripts.length,0);
  m.writeMarketingChoice(true);m.enableStorePixel('1074294225103386',true);assert.equal(scripts.length,1);
  window.fbq.callMethod=(...a)=>calls.push(a);
  m.trackLandingLead('hero');m.trackLandingLead('footer');
  assert.equal(calls.filter(x=>x[2]==='Lead').length,1);
  assert.equal(calls[0][3].lead_source,'landing_whatsapp');assert.equal(calls[0][3].placement,'hero');
  location.pathname='/admin';m.trackLandingLead('header');m.enableStorePixel('123456',true);assert.equal(calls.length,1);
  location.pathname='/';m.writeMarketingChoice(false);m.trackLandingLead('hero');assert.equal(calls.length,1);
 }finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
