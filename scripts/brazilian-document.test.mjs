import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
const documentExports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/brazilian-document.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:documentExports});
const {isValidBrazilianDocument:valid}=documentExports;
test('CPF/CNPJ: aceita dígitos válidos com ou sem máscara',()=>{
 for(const value of ['52998224725','529.982.247-25','11222333000181','11.222.333/0001-81'])assert.equal(valid(value),true,value);
});
test('CPF/CNPJ: rejeita dígitos verificadores incorretos, repetição e entrada malformada',()=>{
 for(const value of ['52998224724','11222333000182','11111111111','00000000000000','','123','abc52998224725','52998224725<script>'])assert.equal(valid(value),false,value);
});
test('cadastro não aceita CPF inválido e mantém documento opcional para a equipe',()=>{
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/customers.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:name=>({'zod':{z},'@/lib/phone':{toE164:()=>'+5511999999999'},'@/lib/brazilian-document':documentExports})[name]});
 const profile={name:'Cliente teste',phone:'11999999999'};
 assert.equal(exports.customerFormSchema.safeParse(profile).success,true);
 assert.equal(exports.customerFormSchema.safeParse({...profile,cpf_cnpj:'52998224724'}).success,false);
 assert.equal(exports.customerFormSchema.safeParse({...profile,cpf_cnpj:'529.982.247-25'}).success,true);
 assert.equal(exports.shippingFormSchema.shape.cpf_cnpj.safeParse('52998224724').success,false);
});
