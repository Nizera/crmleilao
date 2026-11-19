import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(action) {
 const source=fs.readFileSync('src/components/admin/reports/separation-report-view.tsx','utf8');
 const body=source.split('// A report left open by SAC')[1].split('useEffect(() => {')[1].split('}, [date]);')[0];
 const handlers={},tasks=[],reports=[],selections=[];
 const document={visibilityState:'visible',addEventListener:(n,f)=>handlers[n]=f,removeEventListener(){}};
 const navigator={onLine:true};
 const cleanup=vm.runInNewContext(`(function(){${body}})()`,{
  document,navigator,window:{addEventListener:(n,f)=>handlers[n]=f,removeEventListener(){},setInterval:f=>(handlers.tick=f,1),clearInterval(){}},
  busy:{current:false},date:'all',startTransition:f=>tasks.push(f()),getSeparationReportAction:action,
  setReport:r=>reports.push(r),setSelectedIds:r=>selections.push(r),toast:{error(){}},
 });
 return {handlers,tasks,reports,selections,document,navigator,cleanup};
}
test('idle report transport rejection does not escape transition; next refresh recovers',async()=>{
 let calls=0;
 const s=setup(async()=>{if(++calls===1)throw Error('Failed to fetch');return {ok:true,data:{customers:[]}};});
 s.handlers.tick();await s.tasks[0];assert.equal(s.reports.length,0);
 s.handlers.tick();await s.tasks[1];assert.equal(s.reports.length,1);
});
test('idle refresh skips hidden/offline, deduplicates wake events and discards unmounted responses',async()=>{
 let finish,calls=0;
 const s=setup(()=>{calls++;return new Promise(r=>finish=r);});
 s.document.visibilityState='hidden';s.handlers.tick();assert.equal(calls,0);
 s.document.visibilityState='visible';s.navigator.onLine=false;s.handlers.focus();assert.equal(calls,0);
 s.navigator.onLine=true;s.handlers.focus();s.handlers.visibilitychange();assert.equal(calls,1);
 s.cleanup();finish({ok:true,data:{customers:[]}});await s.tasks[0];assert.equal(s.reports.length,0);
});
