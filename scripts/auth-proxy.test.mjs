import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
const commerce={};vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/commerce-access.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:commerce,URL,URLSearchParams,require:()=>({z})});

function loadProxy(user) {
  const cookies = [{ name: 'sb-session', value: '', maxAge: 0 }];
  const response = () => {
    const stored = [...cookies];
    return { cookies: { getAll: () => stored, set: cookie => stored.push(cookie) } };
  };
  const exports = {};
  const source = ts.transpileModule(readFileSync('src/proxy.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, {
    exports, URL,
    require: name => name === '@/lib/commerce-access' ? commerce : name === 'next/server'
      ? { NextResponse: { next: response, redirect: url => ({ ...response(), destination: url.pathname, search: url.search }) } }
      : { refreshSession: async () => ({ user }) },
  });
  return async path => {
    const url = new URL(`https://example.com${path}`);
    url.clone = () => new URL(url);
    const result = await exports.proxy({ nextUrl: url, url:url.href, cookies: { getAll: () => [{ name: 'sb-old-session', value: 'stale' }] } });
    return result;
  };
}

test('cookie antigo de conta apagada vai ao login em vez de criar loop', async () => {
  const proxy = loadProxy(null);
  assert.equal((await proxy('/painel')).destination, '/painel/login');
  assert.ok((await proxy('/painel')).cookies.getAll().some(cookie => cookie.maxAge === 0));
  assert.equal((await proxy('/painel/login')).destination, undefined);
  assert.equal((await proxy('/admin')).destination, '/login');
  assert.equal((await proxy('/login')).destination, undefined);
});

test('sessão validada mantém painel e redireciona login', async () => {
  const proxy = loadProxy({ id: 'valid-user' });
  assert.equal((await proxy('/painel')).destination, undefined);
  assert.equal((await proxy('/painel/login')).destination, '/painel');
  assert.equal((await proxy('/login')).destination, '/admin');
});

test('visitantes navegam catálogo e rifa mas pedidos exigem login; retorno autenticado é restrito',async()=>{
 const guest=loadProxy(null);assert.equal((await guest('/loja')).destination,undefined);assert.equal((await guest('/rifas')).destination,undefined);assert.equal((await guest('/painel/loja')).destination,'/loja');assert.equal((await guest('/painel/rifas')).destination,'/rifas');const orders=await guest('/painel/loja?tab=orders');assert.equal(orders.destination,'/painel/login');assert.equal(new URLSearchParams(orders.search).get('next'),'/painel/loja?tab=orders');
 const member=loadProxy({id:'valid-user'});assert.equal((await member('/painel/login?next='+encodeURIComponent('/painel/loja?resume=cart'))).destination,'/painel/loja');assert.equal((await member('/painel/login?next=https://evil.test')).destination,'/painel');
});
