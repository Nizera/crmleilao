// PostgreSQL real, duas conexões, container descartável. Não usa .env nem banco externo.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const exec=promisify(execFile);
const container=`ocdl-store-test-${crypto.randomUUID()}`;
const sql=command=>new Promise((resolve,reject)=>{
 const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{stdio:['pipe','pipe','pipe']});
 let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code===0?resolve(out.trim()):reject(new Error(err)));p.stdin.end(command);
});
async function race(first,second){
 return new Promise((resolve,reject)=>{
  const p=spawn('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At']);
  let launched=false,concurrent;let err='';
  p.stdout.on('data',b=>{if(!launched&&String(b).includes('LOCK_HELD')){launched=true;concurrent=sql(second).then(value=>({value}),error=>({error}));}});
  p.stderr.on('data',b=>err+=b);p.on('error',reject);
  p.on('close',async code=>{if(code!==0||!launched)return reject(new Error(err||'Primeira transação não obteve o bloqueio.'));resolve(await concurrent);});
  p.stdin.end(`begin;\n${first}\n\\echo LOCK_HELD\nselect pg_sleep(1.5);\ncommit;`);
 });
}
const a='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',product='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const checkout=(customer,key)=>`set role authenticated;select set_config('test.customer','${customer}',false);select checkout_store_cart('${key}','[{"reward_id":"${product}","quantity":1,"mode":"cash","expected_cash":10,"expected_coins":0}]');`;
let created=false;
try{
 await exec('docker',['version','--format','{{.Server.Version}}']);
 await exec('docker',['run','--rm','-d','--name',container,'-e','POSTGRES_PASSWORD=local-disposable-test-only','postgres:17-alpine']);created=true;
 for(let i=0;i<60;i++){try{await exec('docker',['exec',container,'pg_isready','-U','postgres']);break;}catch{if(i===59)throw new Error('PostgreSQL de teste não ficou pronto.');await new Promise(r=>setTimeout(r,500));}}
 for(const file of ['fixtures/store-baseline.sql','../supabase/migrations/0024_store_cart_and_pix.sql','../supabase/migrations/0025_store_catalog_admin.sql'])await sql(await readFile(new URL(file,import.meta.url),'utf8'));
 await sql(`insert into customers(id,email) values('${a}','fixture@example.invalid'),('${b}','fixture@example.invalid');insert into loyalty_rewards(id,name,cash_price,internal_cost,stock,active) values('${product}','Fixture',10,1,1,true);`);
 const lastUnit=await race(checkout(a,crypto.randomUUID()),checkout(b,crypto.randomUUID()));
 assert.match(lastUnit.error?.message??'',/Estoque insuficiente/);
 assert.equal(await sql(`select stock from loyalty_rewards where id='${product}'`),'0');
 console.log('PASS: duas conexões disputam a última unidade sem sobrevenda.');
 // Encerra a reserva anterior pelo fluxo financeiro real da migration.
 await sql(`select settle_store_payment(external_reference,'ORD_first',10,'cancelled',null) from store_orders;update loyalty_rewards set stock=2 where id='${product}';`);
 const key=crypto.randomUUID();const repeated=await race(checkout(a,key),checkout(a,key));
 assert.ok(!repeated.error,repeated.error?.message);
 assert.equal(await sql(`select count(*) from store_orders where customer_id='${a}' and request_key='${key}'`),'1');
 assert.equal(await sql(`select stock from loyalty_rewards where id='${product}'`),'1');
 console.log('PASS: dois checkouts simultâneos com a mesma chave criam uma reserva.');
}catch(error){console.error('Teste de concorrência não concluído:',error.message);process.exitCode=1;}
finally{if(created)await exec('docker',['rm','-f',container]);}
