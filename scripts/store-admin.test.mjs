import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
const require=createRequire(import.meta.url);
const source=await readFile(new URL('../src/lib/store-admin.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace('from "zod"',`from ${JSON.stringify(pathToFileURL(require.resolve('zod')).href)}`);
const {parseProductCsv,PRODUCT_CSV_TEMPLATE,storeProductSchema,isProductImagePath,isProductImageContent}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const baseId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const validId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const invalidId='ffffffff-ffff-4fff-8fff-ffffffffffff';

test('CSV: BOM, aspas, valores brasileiros e rascunhos por padrão',()=>{
  const template=parseProductCsv(PRODUCT_CSV_TEMPLATE);assert.equal(template.errors.length,0);assert.equal(template.rows[0].cash_price,49.9);assert.equal(template.rows[0].active,false);
  const parsed=parseProductCsv('nome;descricao;sku;preco_reais;custo_interno\n"Kit; premium";"Descrição com ""aspas""\ne nova linha";kit-002;"1.234,50";0');
  assert.equal(parsed.errors.length,0);assert.equal(parsed.rows[0].name,'Kit; premium');assert.equal(parsed.rows[0].cash_price,1234.5);assert.equal(parsed.rows[0].sku,'KIT-002');
  assert.ok(parsed.rows[0].description.includes('\n'));
  assert.equal(parseProductCsv('nome,sku,preco_reais\nProduto,SKU-3,12.50').rows[0].cash_price,12.5);
});
test('CSV: rejeita combinações incompletas, duplicações, formatos maliciosos e arquivos grandes',()=>{
  for(const csv of ['nome;sku\nProduto;dup\nOutro;DUP','nome;combinado_reais\nProduto;10,00','nome;preco_reais\nProduto;Infinity','nome;preco_reais\nProduto;-10','nome;nome\nPrimeiro;Segundo','nome;coluna_desconhecida\nProduto;valor','nome;constructor\nProduto;valor','nome;__proto__\nProduto;valor','nome\n"Aspas abertas'])assert.ok(parseProductCsv(csv).errors.length>0,csv);
  assert.ok(parseProductCsv('nome\n'+Array.from({length:201},(_,i)=>`Produto ${i}`).join('\n')).errors.length>0);
  assert.ok(parseProductCsv('x'.repeat(256001)).errors.length>0);
  assert.equal(storeProductSchema.safeParse({name:'Produto',active:true,internal_cost:'0'}).success,false);
});
test('galeria: restringe propriedade do caminho e verifica conteúdo, não só extensão',()=>{
  assert.equal(isProductImagePath(baseId,`loyalty-rewards/${baseId}/foto.webp`),true);
  assert.equal(isProductImagePath(baseId,`loyalty-rewards/${validId}/foto.webp`),false);
  assert.equal(isProductImagePath(baseId,`loyalty-rewards/${baseId}/../foto.webp`),false);
  assert.equal(isProductImageContent(new TextEncoder().encode('<svg onload="alert(1)">'),'image/webp'),false);
  assert.equal(isProductImageContent(new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),'image/png'),true);
  assert.equal(isProductImageContent(new TextEncoder().encode('RIFF1234WEBP'),'image/webp'),true);
});

test('PostgreSQL: catálogo, SKU, galeria, permissões, lote e importação atômica',async(t)=>{
  const db=new PGlite();
  const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
  const owner=()=>db.exec('reset role');
  const admin=()=>db.exec("set role authenticated; select set_config('test.admin','true',false); select set_config('test.readonly','false',false)");
  const customer=()=>db.exec("set role authenticated; select set_config('test.admin','false',false)");
  const catalog=async(query='',status='all',category='',payment='',page=1)=>scalar('select get_store_catalog($1,$2,$3,$4,$5)',[query,status,category,payment,page]);
  const bulk=async(products,action)=>db.query('select bulk_store_products($1,$2)',[JSON.stringify(products),action]);
  const version=async(id)=>({id,updated_at:await scalar('select updated_at::text from loyalty_rewards where id=$1',[id])});
  const imported=async(rows,key=crypto.randomUUID())=>scalar('select import_store_products($1,$2)',[JSON.stringify(rows),key]);
  try{
    await db.exec(await readFile(new URL('./fixtures/store-baseline.sql',import.meta.url),'utf8'));
    await db.exec(await readFile(new URL('../supabase/migrations/0024_store_cart_and_pix.sql',import.meta.url),'utf8'));
    await db.query("insert into loyalty_rewards(id,name,points_cost,cash_price,internal_cost,stock,active,image_path) values($1,'Produto base',100,100,20,10,true,$2)",[baseId,`loyalty-rewards/${baseId}/original.webp`]);
    await db.exec(await readFile(new URL('../supabase/migrations/0025_store_catalog_admin.sql',import.meta.url),'utf8'));
    await t.test('migração preserva capa antiga e cria SKU único; clientes não leem catálogo administrativo',async()=>{
      await admin();const data=await catalog();assert.equal(data.total,1);assert.equal(data.items[0].image_paths[0],`loyalty-rewards/${baseId}/original.webp`);assert.ok(data.items[0].sku.startsWith('PRD-'));
      await customer();await assert.rejects(catalog(),/Acesso negado/);await assert.rejects(db.query('select * from get_store_reserved_quantities()'),/Acesso negado/);await assert.rejects(imported([{name:'Invasão'}]),/Acesso negado/);await assert.rejects(bulk([], 'archive'),/Acesso negado/);
      assert.equal(await scalar('select count(*)::integer from store_catalog_imports'),0);await admin();
    });
    await t.test('capas, ordem, caminhos e limite da galeria são validados no banco',async()=>{
      await owner();const first=`loyalty-rewards/${baseId}/primeira.webp`;const second=`loyalty-rewards/${baseId}/segunda.png`;
      await db.query('update loyalty_rewards set image_paths=$2 where id=$1',[baseId,[first,second]]);
      assert.equal(await scalar('select image_path from loyalty_rewards where id=$1',[baseId]),first);
      await assert.rejects(db.query('update loyalty_rewards set image_paths=$2 where id=$1',[baseId,[`loyalty-rewards/${validId}/foto.webp`]]),/Imagem inválida/);
      await assert.rejects(db.query('update loyalty_rewards set image_paths=$2 where id=$1',[baseId,[first,first]]),/duplicadas/);
      await assert.rejects(db.query('update loyalty_rewards set image_paths=$2 where id=$1',[baseId,Array.from({length:7},(_,i)=>`loyalty-rewards/${baseId}/foto-${i}.webp`)]),/store_gallery_count/);
      await db.query('update loyalty_rewards set image_path=$2 where id=$1',[baseId,`loyalty-rewards/${baseId}/nova.webp`]);
      assert.deepEqual(await scalar('select image_paths from loyalty_rewards where id=$1',[baseId]),[`loyalty-rewards/${baseId}/nova.webp`,second]);
    });
    await t.test('SKU normalizado não duplica por caixa; categoria e campos internos são filtráveis só pelo ADM',async()=>{
      await owner();await db.query("update loyalty_rewards set sku='base-001',category='  Colecionáveis  ' where id=$1",[baseId]);
      assert.equal(await scalar('select sku from loyalty_rewards where id=$1',[baseId]),'BASE-001');
      await assert.rejects(db.query("insert into loyalty_rewards(name,sku) values('Duplicado','BaSe-001')"),/duplicate key/);
      await admin();assert.equal((await catalog('base-001','published','Colecionáveis','cash')).total,1);
      assert.equal((await catalog('%')).total,0);assert.equal((await catalog("' OR 1=1 --")).total,0);
      await assert.rejects(db.query('select internal_cost from loyalty_rewards'),/permission denied/);
    });
    await t.test('ações em lote fazem rollback completo se um produto não puder publicar',async()=>{
      await owner();await db.query("insert into loyalty_rewards(id,name,sku,cash_price,internal_cost,active) values($1,'Rascunho válido','RASC-1',10,0,false),($2,'Rascunho incompleto','RASC-2',null,null,false)",[validId,invalidId]);
      const valid=await version(validId);const invalid=await version(invalidId);await admin();
      await assert.rejects(bulk([valid,invalid],'publish'),/publicar/);
      assert.equal(await scalar('select active from loyalty_rewards where id=$1',[validId]),false);
      assert.equal(await scalar('select updated_at::text from loyalty_rewards where id=$1',[validId]),valid.updated_at);
      await assert.rejects(bulk([{...valid,updated_at:'2000-01-01T00:00:00Z'}],'publish'),/mudou/);
      await bulk([valid],'publish');assert.equal(await scalar('select active from loyalty_rewards where id=$1',[validId]),true);
    });
    await t.test('perfil somente leitura consulta mas não altera ou importa',async()=>{
      await admin();await db.exec("select set_config('test.readonly','true',false)");assert.ok((await catalog()).total>0);
      await assert.rejects(bulk([await version(validId)],'archive'),/Acesso negado/);
      await assert.rejects(imported([{name:'Sem permissão'}]),/Acesso negado/);await admin();
    });
    await t.test('importação repetida é idempotente e um SKU conflitante desfaz todo o arquivo',async()=>{
      await admin();const key=crypto.randomUUID();const rows=[{name:'Importado 1',sku:'IMP-1',cash_price:29.9,category:'Acessórios',internal_cost:0}];
      assert.equal(await imported(rows,key),1);assert.equal(await imported(rows,key),1);
      assert.equal(await scalar("select count(*)::integer from loyalty_rewards where sku='IMP-1'"),1);
      assert.equal(await scalar("select active from loyalty_rewards where sku='IMP-1'"),false);
      await assert.rejects(imported([{...rows[0],name:'Outro arquivo'}],key),/outro arquivo/);
      const before=await scalar('select count(*)::integer from loyalty_rewards');
      await assert.rejects(imported([{name:'Novo',sku:'IMP-2'},{name:'Duplicado',sku:'IMP-1'}]),/duplicate key/);
      assert.equal(await scalar('select count(*)::integer from loyalty_rewards'),before);
      await assert.rejects(imported(Array.from({length:201},()=>({name:'Excesso'}))),/200 produtos/);
    });
    await t.test('paginação no banco, métricas e filtros cobrem o catálogo completo',async()=>{
      await admin();await imported(Array.from({length:30},(_,i)=>({name:`Produto CSV ${i}`,sku:`PAG-${i}`,category:'Paginação',points_cost:200,internal_cost:0,stock:i===0?0:3,low_stock_threshold:5})));
      const page1=await catalog('','draft','Paginação','coins',1);const page2=await catalog('','draft','Paginação','coins',2);
      assert.equal(page1.total,30);assert.equal(page1.items.length,25);assert.equal(page2.items.length,5);
      assert.equal(new Set([...page1.items,...page2.items].map((row)=>row.id)).size,30);
      assert.equal((await catalog('','sold-out','Paginação')).total,1);assert.equal((await catalog('','low-stock','Paginação')).total,29);
      assert.ok(page1.categories.includes('Paginação'));assert.ok(page1.counts.all>=30);
    });
    await t.test('arquivar preserva produtos e pedidos; loja ativa mantém ao menos um produto publicado',async()=>{
      const buyer='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';await owner();
      await db.query('insert into customers(id,email) values($1,$2)',[buyer,'teste@example.invalid']);
      await admin();await db.query("select set_config('test.customer',$1,false)",[buyer]);
      const order=await scalar('select checkout_store_cart($1,$2)',[crypto.randomUUID(),JSON.stringify([{reward_id:baseId,quantity:1,mode:'cash',expected_cash:100,expected_coins:0}])]);
      const pending=(await catalog('BASE-001')).items[0];assert.equal(pending.reserved,1);assert.equal(pending.stock,9);
      await admin();const all=(await catalog()).items; // Ativos são consultados à parte da página de rascunhos.
      assert.ok(all.length>0);
      const active=(await catalog('','published')).items;
      await assert.rejects(bulk(await Promise.all(active.map((row)=>version(row.id))),'archive'),/último produto/);
      await bulk([await version(baseId)],'archive');assert.equal(await scalar('select archived from loyalty_rewards where id=$1',[baseId]),true);
      assert.equal(await scalar('select active from loyalty_rewards where id=$1',[baseId]),false);
      assert.equal(await scalar('select payment_status from store_orders where id=$1',[order]),'creating');
      assert.equal(await scalar('select reward_id::text from store_order_items where order_id=$1',[order]),baseId);
      assert.equal((await catalog('BASE-001','archived')).total,1);
      await owner();await db.exec('set role service_role');await db.query("select settle_store_payment($1,'ORD_archive_test',100,'expired',null)",['shop_'+order]);await owner();await admin();
      assert.equal((await catalog('BASE-001','archived')).items[0].reserved,0);
      await bulk([await version(baseId)],'draft');assert.equal(await scalar('select archived from loyalty_rewards where id=$1',[baseId]),false);
    });
  }finally{await db.close();}
});
