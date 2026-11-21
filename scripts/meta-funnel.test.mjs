import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const compile=(p,module=ts.ModuleKind.CommonJS)=>ts.transpileModule(readFileSync(p,'utf8'),{compilerOptions:{module,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function marketing(choice,path='/'){
 const effects=[],sync=[],events=[];const exports={};
 vm.runInNewContext(compile('src/components/client/store-marketing.tsx'),{exports,URL,Element:class{},window:{fbq:(...x)=>events.push(x),addEventListener(){},removeEventListener(){}},document:{cookie:'',addEventListener(){},removeEventListener(){}},location:{hostname:'example.invalid'},console,require:n=>{
 if(n==='react')return {useEffect:fn=>effects.push(fn),useState:v=>[v,()=>{}],useSyncExternalStore:()=>choice};
 if(n==='react/jsx-runtime')return require(n);
 if(n==='next/navigation')return {usePathname:()=>path};
 if(n==='@/lib/meta-commerce')return {isStoreMarketingPath:p=>p==='/loja'};
 if(n==='@/lib/landing-content')return {LANDING_GROUP_URL:'https://chat.whatsapp.com/group'};
 if(n==='@/lib/meta-browser')return {enableStorePixel(){},leaveStoreMarketing(){},readMarketingChoice(){},subscribeMarketingChoice(){},syncMarketingChoice:async(...args)=>sync.push(args),trackStoreEvent(){},trackLandingLead(){},writeMarketingChoice(){}};
 throw Error(n);
 }});
 const tree=exports.StoreMarketing({pixelId:'1074294225103386'});return {tree,effects,sync};
}
function find(node,text){if(!node)return null;if(Array.isArray(node)){for(const n of node){const result=find(n,text);if(result)return result;}return null;}if(node.props?.children===text)return node;return find(node.props?.children,text);}
test('landing accept/refuse synchronize server consent; accepted visits preserve attribution',()=>{
 const accepted=marketing(true);accepted.effects[0]();assert.equal(accepted.sync[0][0],true);
 for(const [label,value] of [['Aceitar publicidade',true],['Recusar publicidade',false]]){const instance=marketing(null,'/loja');const button=find(instance.tree,label);assert.ok(button);button.props.onClick();assert.deepEqual(instance.sync,[[value,true]]);}
});
test('landing nao abre aviso automaticamente e loja preserva escolha explicita',()=>{
 assert.equal(find(marketing(null).tree,'Aceitar publicidade'),null);
 assert.ok(find(marketing(null,'/loja').tree,'Aceitar publicidade'));
});
test('lead survives reload deduplication and never replaces store events or generates Purchase',async()=>{
 const saved=Object.fromEntries(['window','document','location','localStorage','sessionStorage'].map(k=>[k,globalThis[k]]));const persistent=new Map(),session=new Map();const calls=[];
 globalThis.localStorage={getItem:k=>persistent.get(k)??null,setItem:(k,v)=>persistent.set(k,v)};
 globalThis.sessionStorage={getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v)};
 globalThis.location={pathname:'/',search:'',hostname:'example.invalid'};
 globalThis.document={createElement:()=>({}),head:{appendChild(){}},cookie:''};globalThis.window={dispatchEvent(){},addEventListener(){},removeEventListener(){}};
 const url=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64');
 const rules=url(compile('src/lib/meta-commerce.ts',ts.ModuleKind.ESNext));
 const source=compile('src/lib/meta-browser.ts',ts.ModuleKind.ESNext).replace(/from ['"]@\/lib\/meta-commerce['"]/, 'from '+JSON.stringify(rules));
 try{
  const first=await import(url(source+'\n//first-visit'));first.writeMarketingChoice(true);first.enableStorePixel('1074294225103386',true);window.fbq.callMethod=(...x)=>calls.push(x);
  first.trackLandingLead('hero');first.trackLandingLead('footer');assert.equal(calls.filter(x=>x[2]==='Lead').length,1);
  const reload=await import(url(source+'\n//reload'));reload.enableStorePixel('1074294225103386',true);reload.trackLandingLead('hero');assert.equal(calls.filter(x=>x[2]==='Lead').length,1);
  location.pathname='/loja';reload.enableStorePixel('1074294225103386');reload.trackStoreEvent('PageView');reload.trackStoreProduct('ViewContent',{id:'product',cash_price:45});reload.trackStoreProduct('AddToCart',{id:'product',cash_price:45});reload.trackStoreEvent('InitiateCheckout',{currency:'BRL',value:45},'checkout');
  for(const name of ['PageView','ViewContent','AddToCart','InitiateCheckout'])assert.equal(calls.filter(x=>x[2]===name).length,1);
  assert.ok(!calls.some(x=>x[2]==='Purchase'));assert.ok(calls.filter(x=>x[0]==='trackSingle').every(x=>x[1]==='1074294225103386'));
 }finally{for(const [k,v] of Object.entries(saved)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
