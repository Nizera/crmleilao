import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText).toString('base64');
const datesUrl = moduleUrl(await readFile(new URL('../src/lib/dates.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../src/lib/lot-filters.ts', import.meta.url), 'utf8')).replace('@/lib/dates', datesUrl);
const { lotShiftRange, parseLotRange } = await import(moduleUrl(source));

test('Noite inclui madrugada do dia seguinte e converte São Paulo para UTC', () => {
  const range = parseLotRange(...Object.values(lotShiftRange('2026-10-28', 'night')));
  assert.equal(range.startUtc, '2026-10-28T21:00:00.000Z');
  assert.equal(range.endUtc, '2026-10-29T09:00:00.000Z');
  const matches = instant => instant >= range.startUtc && instant < range.endUtc;
  assert.equal(matches('2026-10-29T03:30:00.000Z'), true);
  assert.equal(matches(range.startUtc), true);
  assert.equal(matches(range.endUtc), false);
});

test('Dia inteiro atravessa mês e ano; manhã termina ao meio-dia', () => {
  assert.deepEqual(lotShiftRange('2026-12-31', 'day'), { from: '2026-12-31T00:00', to: '2027-01-01T00:00' });
  assert.deepEqual(lotShiftRange('2026-10-28', 'morning'), { from: '2026-10-28T06:00', to: '2026-10-28T12:00' });
});

test('Rejeita intervalos inválidos, invertidos e incompletos; aceita intervalo livre', () => {
  for (const [from, to] of [['2026-02-30T12:00', '2026-03-01T12:00'], ['2026-10-28T12:00', '2026-10-28T12:00'], ['2026-10-29T12:00', '2026-10-28T12:00'], ['2026-10-28T12:00', '']]) {
    const range = parseLotRange(from, to);
    assert.ok(range.error);
    assert.equal(range.startUtc, '');
  }
  assert.equal(parseLotRange('2026-10-28T20:00', '2026-10-29T00:30').error, '');
  assert.equal(parseLotRange().error, '');
});
