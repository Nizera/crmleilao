import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../src/lib/store-presentation.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace("from 'zod'",`from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`);
const {bannerSchema,catalogFiltersFrom}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('banner aceita destinos da loja e recusa links externos, scripts e redirecionamentos',()=>{
 const banner={title:'Colecionáveis',subtitle:'Nossa seleção',button_label:'Ver produtos',active:true};
 for(const button_href of ['#catalogo-loja','/painel/loja','/painel/loja?category=Cards&mode=cash'])assert.equal(bannerSchema.safeParse({...banner,button_href}).success,true);
 for(const button_href of ['https://example.invalid','//example.invalid','javascript:alert(1)','/painel/loja/../../login','/painel/loja?x=1\n'])assert.equal(bannerSchema.safeParse({...banner,button_href}).success,false);
});
test('filtros descartam preço sem moeda, negativos, infinito e ordenação desconhecida',()=>{
 assert.equal(catalogFiltersFrom({min:'20'}).min,'');
 const valid=catalogFiltersFrom({mode:'cash',min:'10.50',max:'200',available:'1',sort:'cash_desc'});
 assert.equal(valid.min,'10.50');assert.equal(valid.available,true);assert.equal(valid.sort,'cash_desc');
 const invalid=catalogFiltersFrom({mode:'coins',min:'-10',max:'Infinity',sort:'sql',q:'x'.repeat(200)});
 assert.equal(invalid.min,'');assert.equal(invalid.max,'');assert.equal(invalid.sort,'newest');assert.equal(invalid.q.length,100);
});
