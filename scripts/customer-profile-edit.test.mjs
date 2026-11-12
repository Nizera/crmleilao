import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
const load=(file,deps={})=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,FormData,console,require:n=>{if(!(n in deps))throw Error(n);return deps[n];}});return exports;};
const phone=load('src/lib/phone.ts');
const document=load('src/lib/brazilian-document.ts');
const schema=load('src/lib/customers.ts',{'zod':{z},'@/lib/phone':phone,'@/lib/brazilian-document':document});
const values={name:'Cliente Teste',phone:'11999998888',email:'teste@example.com',address_cep:'12345-678',address_state:'sp'};
test('cadastro permite endereço parcial e rejeita CEP, UF, documento e identificador inválidos',()=>{
 assert.equal(schema.customerFormSchema.safeParse(values).success,true);
 for(const patch of [{address_cep:'123'},{address_state:'XX'},{id:'invalid'},{cpf_cnpj:'11111111111'}])assert.equal(schema.customerFormSchema.safeParse({...values,...patch}).success,false);
});
test('somente administradores com escrita podem salvar dados',async()=>{
 const {saveCustomer}=load('src/app/actions/customers.ts',{'next/cache':{},'@/lib/dal':{requireAdmin:async()=>({profile:{role:'viewer'}})},'@/lib/customers':schema,'@/lib/notes':{},'@/lib/result':{rethrowIfRedirect(){}},'@/lib/supabase/admin':{},'@/lib/supabase/server':{}});
 assert.equal((await saveCustomer(new FormData())).ok,false);
});
test('edição conserva vínculo, atualiza acesso e restaura cadastro se e-mail for recusado',async()=>{
 for(const reject of [false,true]){
  const id='e822317f-0cc5-4ee0-81a3-689b936568f2';let saved,restored,authEmail;
  const old={id,auth_user_id:'auth-original',updated_at:'old',name:'Anterior',phone_e164:'+5511999998888',email:'old@example.com'};
  const db={from(){let mode='read',payload;return {select(){return this},eq(){return this},neq(){return this},ilike(){return this},limit:async()=>({data:[],error:null}),update(row){payload=row;mode='write';return this},maybeSingle:async()=>{if(mode==='read')return {data:old,error:null};if(payload.name==='Anterior')restored=payload;else saved=payload;return {data:{id,updated_at:'new'},error:null}}}}};
  const session={from(){return {select(){return this},eq(){return this},neq(){return this},ilike(){return this},limit:async()=>({data:[],error:null}),maybeSingle:async()=>({data:null,error:null})}}};
  db.auth={admin:{updateUserById:async(user,row)=>{assert.equal(user,'auth-original');authEmail=row.email;return {error:reject?{message:'duplicate'}:null}}}};
  const {saveCustomer}=load('src/app/actions/customers.ts',{'next/cache':{updateTag(){},revalidatePath(){}},'@/lib/dal':{requireAdmin:async()=>({profile:{role:'admin',id:'admin'}})},'@/lib/customers':schema,'@/lib/notes':{saveNote:async()=>{}},'@/lib/result':{rethrowIfRedirect(){}},'@/lib/supabase/admin':{createAdminClient:()=>db},'@/lib/supabase/server':{createClient:async()=>session}});
  const fd=new FormData();for(const[k,v]of Object.entries({...values,id,email:'NEW@example.com'}))fd.set(k,v);
  const result=await saveCustomer(fd);assert.equal(result.ok,!reject);assert.equal(authEmail,'new@example.com');assert.equal(saved.address_cep,'12345678');assert.equal(saved.address_state,'SP');assert.equal(saved.auth_user_id,undefined);assert.equal(!!restored,reject);
 }
});
