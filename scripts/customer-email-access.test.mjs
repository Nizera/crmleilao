import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import ts from 'typescript';
import vm from 'node:vm';
import {z} from 'zod';
const migration=await readFile(new URL('../supabase/migrations/0036_customer_email_access.sql',import.meta.url),'utf8');
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb$$;
 create table public.admin_profiles(id uuid primary key);
 create table public.customers(id uuid primary key default gen_random_uuid(),name text,phone_e164 text not null unique,email text,auth_user_id uuid unique references auth.users(id));
 create table public.customer_invites(customer_id uuid,used_at timestamptz);
 create table public.lots(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),value numeric);
 grant usage on schema public,auth to authenticated,anon,service_role;`);
 await db.exec(migration);return db;
}
async function identity(db,{id=crypto.randomUUID(),email='owner@example.invalid',verified=true,otp=true}={}){
 await db.query('insert into auth.users values($1,$2,$3)',[id,email,verified?new Date().toISOString():null]);
 await db.query('insert into customer_email_proofs(auth_user_id,email) values($1,$2)',[id,email]);
 await db.query("select set_config('test.uid',$1,false),set_config('test.jwt',$2,false)",[id,JSON.stringify({amr:[{method:otp?'otp':'password',timestamp:Math.floor(Date.now()/1000)}]})]);return id;
}
const finish=(db,name='Nome Novo',phone='+5511999999999')=>db.query('select complete_customer_email_access($1,$2) id',[name,phone]);

test('Email: confirmação + OTP recente obrigatórios e perfil administrativo bloqueado',async()=>{
 const db=await fixture();try{
 const id=await identity(db,{verified:false});await assert.rejects(finish(db),/EMAIL_NOT_VERIFIED/);
 await db.query('update auth.users set email_confirmed_at=now() where id=$1',[id]);
 await db.query("select set_config('test.jwt',$1,false)",[JSON.stringify({amr:[{method:'password',timestamp:Math.floor(Date.now()/1000)}]})]);await assert.rejects(finish(db),/EMAIL_OTP_REQUIRED/);
 await db.query("select set_config('test.jwt',$1,false)",[JSON.stringify({amr:[{method:'otp',timestamp:1}]})]);await assert.rejects(finish(db),/EMAIL_OTP_REQUIRED/);
 await db.query("select set_config('test.jwt',$1,false)",[JSON.stringify({amr:[{method:'otp',timestamp:Math.floor(Date.now()/1000)}]})]);
 await db.query('insert into admin_profiles values($1)',[id]);await assert.rejects(finish(db),/ACCOUNT_CONFLICT/);
 }finally{await db.close();}
});

test('Email: cadastro da equipe é vinculado sem duplicar, trocar nome/telefone ou perder lotes; convite antigo é invalidado',async()=>{
 const db=await fixture();try{
 const id=await identity(db);const customer=crypto.randomUUID();
 await db.query("insert into customers values($1,'Cliente Existente','+5511888888888','Owner@Example.Invalid',null)",[customer]);
 await db.query('insert into lots(customer_id,value) values($1,70)',[customer]);await db.query('insert into customer_invites values($1,null)',[customer]);
 assert.equal((await finish(db)).rows[0].id,customer);
 assert.equal((await finish(db)).rows[0].id,customer);
 assert.deepEqual((await db.query('select name,phone_e164,auth_user_id from customers')).rows,[{name:'Cliente Existente',phone_e164:'+5511888888888',auth_user_id:id}]);
 assert.equal((await db.query('select value::int from lots where customer_id=$1',[customer])).rows[0].value,70);
 assert.ok((await db.query('select used_at from customer_invites')).rows[0].used_at);
 }finally{await db.close();}
});

test('Email: conta de convite já vinculada permanece na mesma identidade e outro usuário não a toma',async()=>{
 const db=await fixture();try{
 const id=await identity(db);const customer=crypto.randomUUID();await db.query("insert into customers values($1,'Convidado','+5511888888888','owner@example.invalid',$2)",[customer,id]);
 assert.equal((await finish(db)).rows[0].id,customer);
 await identity(db);await assert.rejects(finish(db),/ACCOUNT_CONFLICT/);
 assert.equal((await db.query('select auth_user_id from customers')).rows[0].auth_user_id,id);
 }finally{await db.close();}
});

test('Email: telefone não comprova posse; conta nova não recebe histórico de outro e-mail',async()=>{
 const db=await fixture();try{
 await identity(db);await db.exec("insert into customers(name,phone_e164,email) values('Outro','+5511999999999','different@example.invalid')");
 await assert.rejects(finish(db),/ACCOUNT_CONFLICT/);
 assert.equal((await db.query('select count(*)::int n from customers')).rows[0].n,1);
 }finally{await db.close();}
});

test('Email: repetições criam apenas um cadastro, unicidade ignora caixa/espaços e funções privadas não podem ser enumeradas',async()=>{
 const db=await fixture();try{
 await identity(db);await db.exec('set role authenticated');const ids=await Promise.all([finish(db),finish(db)]);assert.equal(ids[0].rows[0].id,ids[1].rows[0].id);await db.exec('reset role');
 await assert.rejects(db.exec("insert into customers(name,phone_e164,email) values('Duplicado','+5511777777777',' OWNER@EXAMPLE.INVALID ')") ,/unique/i);
 await db.exec('set role anon');await assert.rejects(db.query("select * from customer_email_access_target('owner@example.invalid')"),/permission denied/i);await assert.rejects(finish(db),/permission denied/i);
 await db.exec('reset role;set role authenticated');await assert.rejects(db.exec('insert into customer_email_proofs(auth_user_id,email) values(gen_random_uuid(),\'fake@example.invalid\')'),/permission denied/i);await assert.rejects(db.query("select * from customer_email_access_target('owner@example.invalid')"),/permission denied/i);
 }finally{await db.close();}
});


test('Email: JWT com OTP não basta sem prova de e-mail gravada pelo servidor',async()=>{
 const db=await fixture();try{
 const id=await identity(db);await db.query('delete from customer_email_proofs where auth_user_id=$1',[id]);
 await assert.rejects(finish(db),/EMAIL_OTP_REQUIRED/);
 await db.query("insert into customer_email_proofs values($1,'other@example.invalid',now())",[id]);await assert.rejects(finish(db),/EMAIL_OTP_REQUIRED/);
 await db.query("update customer_email_proofs set email='owner@example.invalid',verified_at=now()-interval '16 minutes'");await assert.rejects(finish(db),/EMAIL_OTP_REQUIRED/);
 assert.equal((await db.query('select count(*)::int n from customers')).rows[0].n,0);
 }finally{await db.close();}
});

async function emailActions({target=null,account=null,staff=null,lookupError=null,sendError=null,enabled=true,allowed=true}={}){
 const sent=[],attached=[];
 const query={select(){return this},eq(){return this},async maybeSingle(){return {data:staff,error:null}}};
 const admin={rpc:async()=>({data:target?[target]:[],error:lookupError}),from:()=>query,auth:{admin:{getUserById:async()=>({data:{user:account},error:null}),updateUserById:async(id,patch)=>{attached.push({id,patch});return {error:null}}}}};
 const supabase={auth:{signInWithOtp:async input=>{sent.push(input);return {error:sendError}}}};
 const out={exports:{}};
 const source=ts.transpileModule(await readFile(new URL('../src/app/actions/customer-email.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:out.exports,require:name=>{
  if(name==='next/navigation')return {redirect:path=>{throw new Error('redirect:'+path)}};
  if(name==='next/cache')return {revalidatePath(){}};
  if(name==='@/lib/supabase/server')return {createClient:async()=>supabase};
  if(name==='@/lib/supabase/admin')return {createAdminClient:()=>admin};
  if(name==='@/lib/ratelimit')return {allowPublic:async()=>allowed};
  if(name==='@/lib/auth-schemas')return {customerEmailSchema:z.string().trim().toLowerCase().email()};
  if(name==='@/lib/phone')return {};
  throw new Error(name);
 },process:{env:{CUSTOMER_EMAIL_ACCESS_ENABLED:enabled?'true':'false'}},console:{error(){}},Date});
 return {request:out.exports.requestCustomerEmail,sent,attached};
}
const emailForm=()=>{const f=new FormData();f.set('email','Owner@Example.Invalid');return f};

test('Email action: conta antiga só recebe o e-mail já cadastrado, sem confirmar ou trocar senha; conflitos não disparam associação',async()=>{
 const old=await emailActions({target:{auth_user_id:'existing'},account:{id:'existing',phone:'5511999999999'}});
 const response=await old.request(undefined,emailForm());
 assert.equal(response.sent,true);assert.equal(old.attached[0].patch.email,'owner@example.invalid');assert.equal(old.attached[0].patch.email_confirm,false);assert.equal(Object.hasOwn(old.attached[0].patch,'password'),false);
 assert.equal(old.sent[0].options.shouldCreateUser,false);
 const conflict=await emailActions({target:{auth_user_id:'existing'},account:{id:'existing',email:'different@example.invalid'}});
 const denied=await conflict.request(undefined,emailForm());assert.equal(denied.notice,response.notice);assert.equal(conflict.attached.length,0);assert.equal(conflict.sent.length,0);
});

test('Email action: falha fechada sem migration/flag ou rate limit; resposta de entrega não revela existência de conta',async()=>{
 for(const options of [{enabled:false},{allowed:false},{lookupError:{code:'PGRST202'}}]){
 const flow=await emailActions(options);assert.ok((await flow.request(undefined,emailForm())).error);assert.equal(flow.sent.length,0);
 }
 const fresh=await emailActions(),failed=await emailActions({sendError:{status:429,code:'rate_limit'}});
 const a=await fresh.request(undefined,emailForm()),b=await failed.request(undefined,emailForm());assert.equal(a.notice,b.notice);assert.equal(a.sent,b.sent);
 const staff=await emailActions({target:{auth_user_id:'staff'},account:{id:'staff',email:'owner@example.invalid'},staff:{id:'staff'}});
 assert.equal((await staff.request(undefined,emailForm())).notice,a.notice);assert.equal(staff.sent.length,0);
});


async function loginAction({identifier,account}){
 const credentials=[];
 const adminQuery={select(){return this},eq(){return this},async maybeSingle(){return {data:{auth_user_id:account.id},error:null}}};
 const admin={rpc:async()=>({data:[{auth_user_id:account.id}],error:null}),from:()=>adminQuery,auth:{admin:{getUserById:async()=>({data:{user:account},error:null})}}};
 const serverQuery={select(){return this},eq(){return this},async maybeSingle(){return {data:null,error:null}}};
 const supabase={from:()=>serverQuery,auth:{signInWithPassword:async value=>{credentials.push(value);return {data:{user:{id:account.id}},error:null}}}};
 const exported={};
 const source=ts.transpileModule(await readFile(new URL('../src/app/actions/auth.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(source,{exports:exported,require:name=>{
  if(name==='next/navigation')return {redirect:path=>{throw new Error('redirect:'+path)}};
  if(name==='next/cache')return {revalidatePath(){}};
  if(name==='@/lib/supabase/server')return {createClient:async()=>supabase};
  if(name==='@/lib/supabase/admin')return {createAdminClient:()=>admin};
  if(name==='@/lib/ratelimit')return {allowPublic:async()=>true};
  if(name==='@/lib/auth-schemas')return {customerLoginSchema:{safeParse:()=>({success:true,data:{phone:identifier,password:'test-only-password'}})}};
  if(name==='@/lib/customers')return {isShippingComplete:()=>true};
  if(name==='@/lib/invites')return {};
  throw new Error(name);
 },console});
 const form=new FormData();form.set('phone',identifier);form.set('password','test-only-password');
 await assert.rejects(exported.customerSignIn(undefined,form),/redirect:\/painel/);
 return credentials[0];
}

test('Login: e-mail do cliente convidado autentica na conta original por telefone, sem criar usuário',async()=>{
 const credentials=await loginAction({identifier:'owner@example.invalid',account:{id:'existing-auth',phone:'5511999999999'}});
 assert.equal(credentials.phone,'5511999999999');assert.equal(Object.hasOwn(credentials,'email'),false);assert.equal(credentials.password,'test-only-password');
});

test('Login: cliente novo de e-mail entra pelo WhatsApp como alias, usando a senha da mesma conta',async()=>{
 const credentials=await loginAction({identifier:'+5511999999999',account:{id:'email-auth',email:'owner@example.invalid'}});
 assert.equal(credentials.email,'owner@example.invalid');assert.equal(Object.hasOwn(credentials,'phone'),false);assert.equal(credentials.password,'test-only-password');
});
