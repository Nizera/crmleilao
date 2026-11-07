import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {z} from 'zod';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/raffle-dashboard-filters.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>({z})});
const {dashboardCampaignSelection,raffleDashboardOrders}=exports;
test('seleção múltipla deduplica UUIDs e uma seleção inválida nunca amplia para todas',()=>{
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 const result=dashboardCampaignSelection([a,b,a]);assert.equal(result.ids.length,2);assert.equal(result.active,true);assert.equal(result.invalid,false);
 assert.equal(dashboardCampaignSelection('A1111111-1111-4111-8111-111111111111').ids[0],'a1111111-1111-4111-8111-111111111111');
 const invalid=dashboardCampaignSelection(['invalid']);assert.equal(invalid.active,true);assert.equal(invalid.ids.length,0);assert.equal(invalid.invalid,true);
 const orders=[{campaign_id:a,status:'paid',amount:100},{campaign_id:b,status:'paid',amount:200}];
 assert.equal(raffleDashboardOrders(orders,result.ids).length,2);assert.equal(raffleDashboardOrders(orders,[a])[0].amount,100);assert.equal(raffleDashboardOrders(orders,invalid.ids).length,0);assert.equal(raffleDashboardOrders(orders).length,2);
});
test('parâmetros recebidos por URL respeitam o limite de 100 campanhas',()=>{
 const many=Array.from({length:101},(_,i)=>`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`);const selected=dashboardCampaignSelection(many);assert.equal(selected.ids.length,100);assert.equal(selected.invalid,true);
});
