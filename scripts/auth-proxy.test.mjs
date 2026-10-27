import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

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
    require: name => name === 'next/server'
      ? { NextResponse: { next: response, redirect: url => ({ ...response(), destination: url.pathname }) } }
      : { refreshSession: async () => ({ user }) },
  });
  return async path => {
    const url = new URL(`https://example.com${path}`);
    url.clone = () => new URL(url);
    const result = await exports.proxy({ nextUrl: url, cookies: { getAll: () => [{ name: 'sb-old-session', value: 'stale' }] } });
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
