import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(path,deps,extra={}){const exports={};vm.runInNewContext(compile(readFileSync(path,'utf8')),{exports,require:n=>deps[n]??{},console,Map,Set,Date,Promise,...extra});return exports;}
test('home retains every historical total, only fetches visible photos, and preserves pagination',async()=>{
 const rows=Array.from({length:1103},(_,i)=>({id:String(i),customer_id:'owner',status:i===1102?'pending_payment':'paid',auction_date:i===1101?'2026-11-18':'2026-10-01',arremate_value:i,images:['photo-'+i],description:'text-'+i}));
 const queries=[];
 const db={from(table){assert.equal(table,'lots');const q={columns:'',start:0,end:499};queries.push(q);let selected=rows;return {select(c){q.columns=c;return this},eq(k,v){selected=selected.filter(r=>r[k]===v);return this},is(){return this},or(){selected=selected.filter(r=>r.auction_date==='2026-11-18'||r.status==='pending_payment');return this},order(){return this},range(a,b){q.start=a;q.end=b;return this},then(resolve){return Promise.resolve({data:selected.slice(q.start,q.end+1).map(r=>q.columns==='id,images,description'?{id:r.id,images:r.images,description:r.description}:Object.fromEntries(Object.entries(r).filter(([k])=>!['images','description'].includes(k)))),error:null}).then(resolve)}}}};
 const api=load('src/lib/dal.ts',{'react':{cache:fn=>fn},'@/lib/supabase/server':{createClient:async()=>db}});
 const result=await api.listCustomerHomeLots('owner','2026-11-18');
 assert.equal(result.length,1103);assert.equal(result.reduce((s,r)=>s+r.arremate_value,0),rows.reduce((s,r)=>s+r.arremate_value,0));
 assert.equal(result[0].images.length,0);assert.equal(result[1101].images[0],'photo-1101');assert.equal(result[1102].description,'text-1102');
 assert.equal(queries.filter(q=>q.columns==='id,images,description').length,1);assert.equal(queries.filter(q=>q.columns!=='id,images,description').length,3);
 const pending=await api.listLots({hideExpired:true,status:'pending_payment'});assert.equal(pending.length,1);assert.equal(pending[0].status,'pending_payment');
 rows.slice(0,1001).forEach(row=>{row.status='pending_payment';});
 const large=await api.listCustomerHomeLots('owner','2026-11-18');
 assert.equal(large.filter(row=>row.images.length>0).length,1003,'no cap on visible/pending photos');

});
test('payment expiry sleeps until deadline, handles resume and releases timer',()=>{
 let now=1000,subscribe;const timers=new Map(),events=new Map();let id=0,notifications=0;
 const api=load('src/components/client/use-payment-expired.ts',{'react':{useCallback:fn=>fn,useSyncExternalStore(fn){subscribe=fn;return false}},'@/lib/payment-ui':{isPaymentExpired:()=>false}},{Date:{parse:()=>6000,now:()=>now},setTimeout(fn,delay){timers.set(++id,{fn,delay});return id},clearTimeout(i){timers.delete(i)},document:{visibilityState:'visible',addEventListener:(k,fn)=>events.set(k,fn),removeEventListener:k=>events.delete(k)}});
 api.usePaymentExpired('deadline');const stop=subscribe(()=>notifications++);assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,5000);
 now=6000;const timer=[...timers.values()][0];timers.clear();timer.fn();assert.equal(notifications,1);assert.equal(timers.size,0);
 stop();assert.equal(events.size,0);
});

test('dashboard uses bounded concurrency without dropping rows or exposing partial totals on failure',async()=>{
 let active=0,maxActive=0,fail=false;
 const db={from(){let ids=[];return {select(){return this},in(k,v){ids=v;return this},order(){return this},async range(){active++;maxActive=Math.max(maxActive,active);await new Promise(setImmediate);active--;return fail&&ids[0]==='100'?{data:null,error:{message:'offline'}}:{data:ids.map(id=>({id})),error:null};}}}};
 const api=load('src/lib/dashboard-scope-server.ts',{});
 const ids=Array.from({length:350},(_,i)=>String(i));
 const result=await api.fetchScopeRows(db,'lots','id',[...ids,'1'],'id');
 assert.equal(maxActive,2);assert.deepEqual(Array.from(result.data,r=>r.id),ids);
 fail=true;const broken=await api.fetchScopeRows(db,'lots','id',ids,'id');assert.equal(broken.data.length,0);assert.equal(broken.error.message,'offline');
});
