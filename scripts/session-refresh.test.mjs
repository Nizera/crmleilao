import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);const {NextRequest,NextResponse}=require('next/server');
const compile=path=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function load(path,deps){const exports={};vm.runInNewContext(compile(path),{exports,require:name=>{assert.ok(name in deps,name);return deps[name]},URL,Headers,console});return exports;}
function fixture({expired=false,multiple=false}={}){
 const helper=load('src/lib/supabase/proxy.ts',{'next/server':{NextResponse},'./env':{supabaseUrl:()=> 'https://example.supabase.co',supabasePublishableKey:()=> 'public-key'},'@supabase/ssr':{createServerClient(_url,_key,{cookies}){return {auth:{async getUser(){
 assert.equal(cookies.getAll().find(c=>c.name==='sb-session')?.value,'old-token');
 cookies.setAll([{name:'sb-session',value:expired?'':'new-token',options:{path:'/',maxAge:expired?0:3600,sameSite:'lax',secure:true}}],{'Cache-Control':'private, no-cache, no-store, must-revalidate, max-age=0',Expires:'0',Pragma:'no-cache'});
 if(multiple)cookies.setAll([{name:'sb-other',value:'second',options:{path:'/'}}],{});
 return {data:{user:expired?null:{id:'verified-user'}},error:expired?{code:'refresh_token_not_found'}:null};
 }}}}}});
 const main=load('src/proxy.ts',{'next/server':{NextResponse},'@/lib/commerce-access':{safeCommerceNext:()=> '/painel'},'@/lib/supabase/proxy':helper});return {helper,main};
}
for(const path of ['/admin/lotes','/admin/relatorios'])test('rotated session reaches '+path+' during the same request',async()=>{
 const {main}=fixture();const request=new NextRequest('https://site.invalid'+path,{headers:{cookie:'sb-session=old-token'}});
 const result=await main.proxy(request);
 assert.ok(result.headers.get('x-middleware-request-cookie').includes('new-token'));
 assert.ok(!result.headers.get('x-middleware-request-cookie').includes('old-token'));
 assert.equal(result.cookies.get('sb-session').value,'new-token');assert.equal(result.cookies.get('sb-session').secure,true);
 assert.equal(result.headers.get('pragma'),'no-cache');assert.ok(result.headers.get('cache-control').includes('no-store'));assert.equal(result.headers.get('location'),null);
});
test('invalid refresh returns login with cookie cleanup and private cache policy',async()=>{
 const {main}=fixture({expired:true});const result=await main.proxy(new NextRequest('https://site.invalid/admin/relatorios',{headers:{cookie:'sb-session=old-token'}}));
 assert.equal(result.status,307);assert.equal(new URL(result.headers.get('location')).pathname,'/login');assert.equal(result.cookies.get('sb-session').maxAge,0);assert.equal(result.headers.get('pragma'),'no-cache');assert.ok(result.headers.get('cache-control').includes('no-store'));
});
test('multiple cookie writes preserve previous cookies, cache policy and current request',async()=>{
 const {helper}=fixture({multiple:true});const request=new NextRequest('https://site.invalid/admin/lotes',{headers:{cookie:'sb-session=old-token'}});const initial=NextResponse.next({request});initial.cookies.set('existing','keep',{path:'/'});
 const result=await helper.refreshSession(request,initial);assert.notEqual(result.response,initial);
 assert.equal(result.response.cookies.get('existing').value,'keep');assert.equal(result.response.cookies.get('sb-session').value,'new-token');assert.equal(result.response.cookies.get('sb-other').value,'second');assert.equal(result.response.headers.get('pragma'),'no-cache');assert.ok(result.response.headers.get('x-middleware-request-cookie').includes('sb-other=second'));
});
