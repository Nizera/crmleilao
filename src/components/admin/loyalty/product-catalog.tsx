"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo,useRef,useState,useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive,ArrowDownToLine,ChevronLeft,ChevronRight,FileUp,MoreHorizontal,Package,Plus,Search,TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { bulkStoreProductsAction,importStoreProductsAction } from "@/app/actions/store-products";
import { CATALOG_PATH,PRODUCT_CSV_TEMPLATE,parseProductCsv,type AdminProduct,type CatalogData,type CatalogStatus } from "@/lib/store-admin";
import type { CatalogFilters } from "@/lib/store-admin-server";
import { priceLabel,productPrices } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table,TableBody,TableCell,TableHead,TableHeader,TableRow } from "@/components/ui/table";
import { DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuSeparator,DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet,SheetContent,SheetDescription,SheetHeader,SheetTitle } from "@/components/ui/sheet";

export function CatalogImport({disabled=false}:{disabled?:boolean}) {
  const router=useRouter(); const [open,setOpen]=useState(false); const [csv,setCsv]=useState(""); const [filename,setFilename]=useState("");
  const [pending,startTransition]=useTransition(); const readSequence=useRef(0);const importKey=useRef("");
  const preview=useMemo(()=>csv?parseProductCsv(csv):{rows:[],errors:[]},[csv]);
  const template=()=>{
    const url=URL.createObjectURL(new Blob([PRODUCT_CSV_TEMPLATE],{type:"text/csv;charset=utf-8"}));
    const anchor=document.createElement("a"); anchor.href=url; anchor.download="modelo-produtos.csv"; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <><Button variant="outline" disabled={disabled} onClick={()=>setOpen(true)}><FileUp className="size-4" />Importar</Button>
    <Sheet open={open} onOpenChange={(value)=>{if(!pending)setOpen(value);}}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"><SheetHeader><SheetTitle>Importar produtos</SheetTitle><SheetDescription>Confira o CSV antes de gravar. Todos os produtos entram como rascunho; SKUs existentes não são sobrescritos.</SheetDescription></SheetHeader>
      <div className="grid gap-4 p-4"><Button variant="outline" onClick={template} className="w-fit"><ArrowDownToLine />Baixar modelo CSV</Button><label className="grid gap-2 text-sm font-medium">Arquivo CSV<Input type="file" accept=".csv,text/csv" disabled={pending} onChange={async(event)=>{
        const file=event.target.files?.[0]; const sequence=++readSequence.current; setCsv(""); setFilename("");
        if(!file)return; if(file.size>256000){toast.error("Use um CSV de até 250 KB.");return;}
        try{const text=await file.text();if(sequence===readSequence.current){importKey.current=crypto.randomUUID();setCsv(text);setFilename(file.name);}}catch{toast.error("Não foi possível ler o arquivo.");}
      }} /></label>
      <p className="text-xs text-muted-foreground">Até 200 produtos por arquivo. Aceita CSV com ponto e vírgula ou vírgula, campos entre aspas e valores como 49,90. Imagens são adicionadas depois no cadastro.</p>
      {filename && <p className="text-sm font-semibold">{filename} · {preview.rows.length} produto(s) válido(s)</p>}
      {preview.errors.length>0 && <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{preview.errors.map((error,i)=><p key={i}>{error}</p>)}<p>Nenhum produto será importado até corrigir o arquivo.</p></div>}
      {preview.rows.length>0 && <div className="overflow-x-auto rounded-xl border"><Table><TableHeader><TableRow><TableHead>Produto</TableHead><TableHead>SKU</TableHead><TableHead>Categoria</TableHead></TableRow></TableHeader><TableBody>{preview.rows.slice(0,10).map((row,i)=><TableRow key={i}><TableCell>{row.name}</TableCell><TableCell>{row.sku || "Automático"}</TableCell><TableCell>{row.category}</TableCell></TableRow>)}</TableBody></Table><p className="p-3 text-xs text-muted-foreground">Prévia dos primeiros 10 produtos. Os preços também são validados antes da importação.</p></div>}
      <Button disabled={pending || !preview.rows.length || preview.errors.length>0} className="bg-amarelo text-black hover:bg-amarelo/90" onClick={()=>startTransition(async()=>{
        try{const result=await importStoreProductsAction(csv,importKey.current);if(!result.ok){toast.error(result.error);return;}toast.success(`${result.data.count} produtos importados como rascunho.`);setCsv("");setFilename("");setOpen(false);router.refresh();}catch{toast.error("Falha na conexão. Você pode tentar novamente; a mesma importação não será duplicada.");}
      })}>{pending?"Importando…":`Importar ${preview.rows.length} produto(s)`}</Button></div>
    </SheetContent></Sheet>
  </>;
}

const tabs:[CatalogStatus,string][]=[["all","Todos"],["published","Publicados"],["draft","Rascunhos"],["sold-out","Esgotados"],["archived","Arquivados"]];
export function ProductCatalog({data,filters,canEdit}:{data:CatalogData;filters:CatalogFilters;canEdit:boolean}) {
  const router=useRouter(); const [query,setQuery]=useState(filters.q); const [selected,setSelected]=useState<string[]>([]); const [pending,startTransition]=useTransition();
  const href=(patch:Partial<CatalogFilters>)=>{
    const value={...filters,...patch}; const params=new URLSearchParams();
    if(value.q)params.set("q",value.q);if(value.status!=="all")params.set("status",value.status);if(value.category)params.set("category",value.category);if(value.payment)params.set("payment",value.payment);if(value.page>1)params.set("page",String(value.page));
    return `${CATALOG_PATH}${params.size?`?${params}`:""}`;
  };
  const run=(action:"publish"|"draft"|"archive",products:AdminProduct[])=>{
    if(!products.length)return;
    if(action==="archive" && !window.confirm(`Arquivar ${products.length} produto(s)? Pedidos e histórico serão preservados.`))return;
    startTransition(async()=>{
      try{const result=await bulkStoreProductsAction({action,products:products.map((product)=>({id:product.id,updated_at:product.updated_at}))});
        if(!result.ok){toast.error(result.error);return;}toast.success(`${result.data.count} produto(s) atualizado(s).`);setSelected([]);router.refresh();
      }catch{toast.error("Não foi possível atualizar. Confira o catálogo antes de repetir.");}
    });
  };
  const lastPage=Math.max(1,Math.ceil(data.total/25)); const chosen=data.items.filter((product)=>selected.includes(product.id));
  return <div className="grid min-w-0 gap-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs text-muted-foreground">Loja / Produtos</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Produtos</h1><p className="mt-1 text-sm text-muted-foreground">Gerencie o catálogo, os preços e o estoque da loja.</p></div>{canEdit && <div className="flex gap-2"><CatalogImport /><Button asChild className="bg-amarelo text-black hover:bg-amarelo/90"><Link href={`${CATALOG_PATH}/novo`}><Plus />Novo produto</Link></Button></div>}</header>
    <div className="grid gap-3 sm:grid-cols-3">{[[Package,data.counts.all,"produtos no catálogo"],[Package,data.counts.published,"publicados"],[TriangleAlert,data.counts["low-stock"],"com estoque baixo"]].map(([Icon,value,label],i)=>{const MetricIcon=Icon as typeof Package;return <Link key={i} href={href({status:i===1?"published":i===2?"low-stock":"all",page:1})} className="flex items-center gap-3 rounded-xl border bg-card p-4"><MetricIcon className={`size-6 ${i===2?"text-amber-500":"text-ouro-ink"}`} /><div><p className="text-2xl font-bold">{String(value)}</p><p className="text-xs text-muted-foreground">{String(label)}</p></div></Link>;})}</div>
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><nav aria-label="Situação dos produtos" className="flex max-w-full gap-1 overflow-x-auto">{tabs.map(([status,label])=><Link key={status} href={href({status,page:1})} aria-current={filters.status===status?"page":undefined} className={`whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${filters.status===status?"bg-amarelo/15 text-ouro-ink":"text-muted-foreground hover:bg-muted"}`}>{label} <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{data.counts[status]}</span></Link>)}</nav>
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={(event)=>{event.preventDefault();router.push(href({q:query,page:1}));}}><label className="relative min-w-44 flex-1"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input aria-label="Buscar por nome ou SKU" placeholder="Buscar por nome ou SKU" value={query} onChange={(event)=>setQuery(event.target.value)} maxLength={100} className="pl-9" /></label><Button type="submit" variant="outline">Buscar</Button>
          <select aria-label="Categoria" value={filters.category} onChange={(event)=>router.push(href({category:event.target.value,page:1}))} className="h-10 max-w-full rounded-lg border bg-background px-3 text-xs"><option value="">Todas as categorias</option>{data.categories.map((category)=><option key={category}>{category}</option>)}</select>
          <select aria-label="Forma de pagamento" value={filters.payment} onChange={(event)=>router.push(href({payment:event.target.value,page:1}))} className="h-10 rounded-lg border bg-background px-3 text-xs"><option value="">Todos os pagamentos</option><option value="cash">Reais</option><option value="coins">Caracoins</option><option value="mixed">Reais + Caracoins</option></select>
          {filters.status==="low-stock" && <Button asChild size="sm" variant="outline"><Link href={href({status:"all",page:1})}>Limpar estoque baixo</Link></Button>}
        </form>
      </div>
      <Table className="min-w-[760px]"><TableHeader><TableRow><TableHead className="w-10 pl-4"><input type="checkbox" aria-label="Selecionar produtos desta página" disabled={!canEdit || pending || !data.items.length} checked={data.items.length>0 && selected.length===data.items.length} ref={(node)=>{if(node)node.indeterminate=selected.length>0 && selected.length<data.items.length;}} onChange={(event)=>setSelected(event.target.checked?data.items.map((product)=>product.id):[])} /></TableHead><TableHead>Produto</TableHead><TableHead>Status</TableHead><TableHead>Estoque</TableHead><TableHead>Preços</TableHead><TableHead>Categoria</TableHead><TableHead className="pr-4 text-right">Ações</TableHead></TableRow></TableHeader><TableBody>
        {data.items.map((product)=><TableRow key={product.id} data-state={selected.includes(product.id)?"selected":undefined}><TableCell className="pl-4"><input type="checkbox" aria-label={`Selecionar ${product.name}`} disabled={!canEdit || pending} checked={selected.includes(product.id)} onChange={(event)=>setSelected(event.target.checked?[...selected,product.id]:selected.filter((id)=>id!==product.id))} /></TableCell>
          <TableCell><Link href={`${CATALOG_PATH}/${product.id}`} className="flex items-center gap-3"><span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border bg-white">{product.image_path?<Image src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${product.image_path}`} alt="" width={48} height={48} className="size-full object-contain p-1" />:<Package className="size-5 text-amber-600" />}</span><span><span className="block max-w-64 truncate font-semibold hover:underline">{product.name}</span><span className="block max-w-56 truncate text-xs text-muted-foreground">SKU: {product.sku}</span></span></Link></TableCell>
          <TableCell><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${product.active?"bg-emerald-500/10 text-emerald-600":"bg-muted text-muted-foreground"}`}>{product.archived?"Arquivado":product.active?"Publicado":"Rascunho"}</span></TableCell>
          <TableCell><p className="font-medium tabular-nums">{product.stock===null?"Sem limite":product.stock}</p><p className="text-[11px] text-muted-foreground">{product.reserved} reservado(s)</p>{product.stock!==null && product.stock>0 && product.low_stock_threshold!==null && product.stock<=product.low_stock_threshold && <span className="text-[10px] font-semibold text-amber-600">Estoque baixo</span>}{product.stock===0 && <span className="text-[10px] text-destructive">Esgotado</span>}</TableCell>
          <TableCell className="min-w-40">{productPrices(product).map((price)=><p key={price.mode} className="text-xs font-medium leading-relaxed">{priceLabel(price.cash,price.coins)}</p>)}{productPrices(product).length===0 && <span className="text-xs text-muted-foreground">A definir</span>}</TableCell><TableCell className="max-w-40 truncate text-xs text-muted-foreground">{product.category}</TableCell>
          <TableCell className="pr-4 text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Ações de ${product.name}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={`${CATALOG_PATH}/${product.id}`}>{canEdit?"Editar produto":"Ver produto"}</Link></DropdownMenuItem>{canEdit && <><DropdownMenuSeparator /><DropdownMenuItem disabled={pending} onClick={()=>run("publish",[product])}>Publicar</DropdownMenuItem><DropdownMenuItem disabled={pending} onClick={()=>run("draft",[product])}>Mover para rascunho</DropdownMenuItem><DropdownMenuItem disabled={pending} onClick={()=>run("archive",[product])}><Archive className="size-4" />Arquivar</DropdownMenuItem></>}</DropdownMenuContent></DropdownMenu></TableCell>
        </TableRow>)}
        {!data.items.length && <TableRow><TableCell colSpan={7} className="py-14 text-center"><Package className="mx-auto mb-2 size-8 text-muted-foreground" /><p className="font-semibold">Nenhum produto encontrado</p><p className="mt-1 text-xs text-muted-foreground">Ajuste os filtros ou cadastre o primeiro produto.</p></TableCell></TableRow>}
      </TableBody></Table>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-4"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{selected.length} selecionado(s)</span>{canEdit && chosen.length>0 && <><Button size="sm" variant="outline" disabled={pending} onClick={()=>run("publish",chosen)}>Publicar</Button><Button size="sm" variant="outline" disabled={pending} onClick={()=>run("draft",chosen)}>Rascunho</Button><Button size="sm" variant="outline" disabled={pending} onClick={()=>run("archive",chosen)}>Arquivar</Button></>}</div><div className="flex items-center gap-2"><span className="mr-2 text-xs text-muted-foreground">{data.total===0?0:(filters.page-1)*25+1}–{Math.min(filters.page*25,data.total)} de {data.total}</span><Button asChild size="icon" variant="outline" disabled={filters.page<=1}><Link aria-label="Página anterior" aria-disabled={filters.page<=1} tabIndex={filters.page<=1?-1:0} className={filters.page<=1?"pointer-events-none opacity-40":""} href={href({page:Math.max(1,filters.page-1)})}><ChevronLeft /></Link></Button><span className="rounded-lg bg-amarelo/15 px-3 py-2 text-xs font-semibold">{filters.page}</span><Button asChild size="icon" variant="outline" disabled={filters.page>=lastPage}><Link aria-label="Próxima página" aria-disabled={filters.page>=lastPage} tabIndex={filters.page>=lastPage?-1:0} className={filters.page>=lastPage?"pointer-events-none opacity-40":""} href={href({page:Math.min(lastPage,filters.page+1)})}><ChevronRight /></Link></Button></div></footer>
    </section>
    {!canEdit && <p className="text-sm text-muted-foreground">Seu perfil pode consultar o catálogo. Alterações são reservadas à equipe com permissão de escrita.</p>}
  </div>;
}
