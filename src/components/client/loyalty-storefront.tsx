"use client";

import Image from "next/image";
import { useEffect, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Gift, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getCartProducts } from "@/app/actions/loyalty-history";
import type { CustomerCatalog } from "@/lib/loyalty-history";
import type {StoreFreightQuote} from "@/lib/store-freight";
import { checkoutStoreAction,getStoreFreightQuoteAction } from "@/app/actions/store";
import { cartCheckoutSchema, cartTotals, coinNumber, priceLabel, productPrices, storeBRL, type CartLine, type PriceMode, type StoreProduct } from "@/lib/store";
import {voucherDiscount,type CustomerVoucher} from "@/lib/store-vouchers";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { StoreSearch } from "./store-search";
import { StoreHero } from "./store-hero";
import { StoreCatalogControls } from "./store-catalog-controls";
import type { CatalogFilters, StoreBanner } from "@/lib/store-presentation";

type Cart = { items: CartLine[]; requestKey: string };
const emptyCart: Cart = { items: [], requestKey: "" };
function ProductCard({ product, onAdd, purchasesEnabled }: { purchasesEnabled:boolean;product: StoreProduct; onAdd: (product: StoreProduct, mode: PriceMode) => void }) {
  const options = productPrices(product);
  const mode = options[0]?.mode ?? "coins";
  const [details,setDetails]=useState(false);
  const [photoIndex,setPhotoIndex]=useState(0);
  const gallery=product.image_paths?.length?product.image_paths:product.image_path?[product.image_path]:[];
  const photoUrl=(path:string)=>`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${path}`;
  const price = options.find((option) => option.mode === mode) ?? options[0];
  const imageUrl = product.image_path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${product.image_path}` : null;
  return <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-card transition-shadow hover:shadow-lg">
    <button type="button" aria-label={`Ver fotos e detalhes de ${product.name}`} onClick={()=>setDetails(true)} className="relative block aspect-square w-full bg-white">
      {imageUrl ? <Image src={imageUrl} alt={product.name} fill sizes="(max-width: 640px) 45vw, (max-width:1024px) 30vw, 280px" className="object-contain p-3 transition-transform duration-500 group-hover:scale-105 sm:p-5" /> : <Gift className="absolute inset-0 m-auto size-12 text-amber-600" />}
      {product.stock !== 0 && <span className="absolute left-2 top-2 rounded-md bg-white/95 px-2 py-1 text-[10px] font-medium text-emerald-800">Em estoque</span>}{product.stock === 0 && <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs text-white">Esgotado</span>}
      {product.stock !== null && product.stock > 0 && product.stock <= 5 && <span className="absolute bottom-2 left-2 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">Últimas unidades</span>}
      {gallery.length>1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white">{gallery.length} fotos</span>}
    </button>
    <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
      <div><p className="mb-1 text-[10px] text-muted-foreground">{product.category||'Colecionáveis'}</p><button type="button" onClick={()=>setDetails(true)} className="text-left"><h3 className="line-clamp-2 min-h-10 text-sm font-semibold leading-5">{product.name}</h3></button></div>
      <div className="mt-auto grid gap-2">
        <p className="text-base font-bold leading-snug text-foreground sm:text-lg">{price ? priceLabel(price.cash, price.coins) : "Em breve"}</p>
        <Button size="sm" className="w-full text-xs sm:text-sm" disabled={!purchasesEnabled || !price || product.stock === 0} onClick={() => price && onAdd(product, price.mode)}><Plus className="size-3.5" /> Adicionar</Button>
      </div>
    </div>
    <Sheet open={details} onOpenChange={setDetails}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"><SheetHeader><SheetTitle>{product.name}</SheetTitle><SheetDescription>{product.category || "Produto da loja"}{product.sku?` · ${product.sku}`:""}</SheetDescription></SheetHeader><div className="grid gap-4 p-4">
      {gallery.length>0 && <><div className="relative aspect-square rounded-xl bg-white"><Image src={photoUrl(gallery[Math.min(photoIndex,gallery.length-1)])} alt={product.name} fill sizes="(max-width:640px) 90vw,440px" className="object-contain p-3" /></div>{gallery.length>1 && <div className="flex flex-wrap gap-2">{gallery.map((path,index)=><button type="button" key={path} aria-label={`Ver foto ${index+1}`} aria-pressed={photoIndex===index} onClick={()=>setPhotoIndex(index)} className={`overflow-hidden rounded-lg border ${photoIndex===index?"border-ouro ring-1 ring-ouro":""}`}><Image src={photoUrl(path)} alt="" width={64} height={64} className="size-16 bg-white object-contain p-1" /></button>)}</div>}</>}
      {product.description && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.description}</p>}
      <p className="font-bold text-ouro-ink">{price?priceLabel(price.cash,price.coins):"Preço a definir"}</p><Button disabled={!purchasesEnabled || !price || product.stock===0} onClick={()=>{if(price){onAdd(product,price.mode);setDetails(false);}}}><Plus />Adicionar ao carrinho</Button>
    </div></SheetContent></Sheet>
  </article>;
}

export function LoyaltyStorefront({ rewards, balance, customerId, hasOpenOrder, vouchers=[], catalog, catalogFilters, banner, purchasesEnabled=false }: { rewards: StoreProduct[]; balance: number; customerId: string; hasOpenOrder: boolean; vouchers?:CustomerVoucher[]; catalog:CustomerCatalog; catalogFilters:CatalogFilters; banner?:Partial<StoreBanner>|null;purchasesEnabled?:boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedVoucher,setSelectedVoucher]=useState("");
  const [freightRevision,setFreightRevision]=useState(0);
  const [freightSnapshot,setFreightSnapshot]=useState<{key:string;quote:StoreFreightQuote|null;error:string}>({key:"",quote:null,error:""});
  const [cart, dispatch] = useReducer((_: Cart, next: Cart) => next, emptyCart);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const [retryCart,setRetryCart]=useState(0);
  const cartIds=Array.from(new Set(cart.items.map(item=>item.reward_id))).sort().join(',');
  const cartVersion=cart.requestKey;
  const [cartSnapshot,setCartSnapshot]=useState<{ids:string;version:string;source:StoreProduct[];retry:number;products:StoreProduct[];error:string}>({ids:'',version:'',source:rewards,retry:0,products:[],error:''});
  const cartLoading=!!cartIds&&(cartSnapshot.ids!==cartIds||cartSnapshot.version!==cartVersion||cartSnapshot.source!==rewards||cartSnapshot.retry!==retryCart);
  const cartError=cartLoading?'':cartSnapshot.error;
  useEffect(()=>{
    if(!cartIds)return;
    let cancelled=false;
    getCartProducts(cartIds.split(',')).then(result=>{if(cancelled)return;setCartSnapshot({ids:cartIds,version:cartVersion,source:rewards,retry:retryCart,products:result.ok?result.data:[],error:result.ok?'':result.error});}).catch(()=>{if(!cancelled)setCartSnapshot({ids:cartIds,version:cartVersion,source:rewards,retry:retryCart,products:[],error:'Não foi possível atualizar os itens do carrinho.'});});
    return()=>{cancelled=true;};
  },[cartIds,cartVersion,rewards,retryCart]);
  const products=[...rewards,...cartSnapshot.products.filter(product=>!rewards.some(visible=>visible.id===product.id))];
  const hasPhysical=cart.items.some(item=>products.find(p=>p.id===item.reward_id)?.delivery_kind!=='digital');
  const freightKey=`${customerId}|${cartIds}|${freightRevision}`;
  const freightLoading=hasPhysical&&freightSnapshot.key!==freightKey;
  const freightQuote=freightSnapshot.key===freightKey?freightSnapshot.quote:null;
  const freightError=hasPhysical&&freightSnapshot.key===freightKey?freightSnapshot.error:'';
  const freightBlocked=hasPhysical&&freightQuote?.status==='awaiting';
  const freight=hasPhysical?(freightQuote?.amount??0):0;
  const openCart=()=>{setFreightRevision(n=>n+1);setOpen(true);};
  useEffect(()=>{
    if(!open||!hasPhysical)return;
    let disposed=false;
    getStoreFreightQuoteAction().then(result=>{if(!disposed)setFreightSnapshot({key:freightKey,quote:result.ok?result.data:null,error:result.ok?'':result.error});}).catch(()=>{if(!disposed)setFreightSnapshot({key:freightKey,quote:null,error:'Não foi possível conferir o frete.'});});
    return()=>{disposed=true;};
  },[open,hasPhysical,freightKey]);
  const storageKey = `ocdl-store-cart-v1:${customerId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const parsed = cartCheckoutSchema.safeParse(saved);
      if (parsed.success) dispatch(parsed.data);
    } catch { /* Carrinho local inválido: começa vazio. */ }
  }, [storageKey]);
  const update = (items: CartLine[]) => {
    if(!items.length)setSelectedVoucher("");
    const next = { items, requestKey: crypto.randomUUID() };
    dispatch(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Carrinho continua disponível nesta aba. */ }
  };
  const add = (product: StoreProduct, mode: PriceMode) => {
    if(!purchasesEnabled)return;
    if(cart.items.length && cart.items[0].mode!==mode){toast.error("Finalize o carrinho atual antes de trocar entre reais e Caracoins.");return;}
    const price = productPrices(product).find((option) => option.mode === mode);
    if (!price) return;
    const quantity = cart.items.filter((item) => item.reward_id === product.id).reduce((sum, item) => sum + item.quantity, 0);
    if (product.stock !== null && quantity >= product.stock) { toast.error("Você já adicionou o estoque disponível deste produto."); return; }
    const existing = cart.items.find((item) => item.reward_id === product.id && item.mode === mode);
    if (existing && existing.quantity >= 99) return;
    if (!existing && cart.items.length >= 50) { toast.error("O carrinho aceita até 50 combinações de produtos."); return; }
    update(existing ? cart.items.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item) : [...cart.items, { reward_id: product.id, mode, quantity: 1, expected_cash: price.cash, expected_coins: price.coins }]);
    toast.success("Adicionado ao carrinho", { action: { label: "Ver carrinho", onClick: () => openCart() } });
  };
  const totals = cartTotals(cart.items);
  const selected = vouchers.find(v=>v.id===selectedVoucher);
  const discount = totals.cash>0?voucherDiscount(selected,cart.items):0;
  const cashDue = Math.max(0,totals.cash-discount)+Math.round(freight*100);
  const missing = totals.coins > 0 ? Math.max(0, totals.coins / 100 - balance) : 0;
  const currentPrice = (item: CartLine) => { const product = products.find((p) => p.id === item.reward_id); return product ? productPrices(product).find((price) => price.mode === item.mode) : undefined; };
  const changed = (item: CartLine) => { const price = currentPrice(item); return !price || price.cash !== item.expected_cash || price.coins !== item.expected_coins; };
  const hasStaleItems = cart.items.some(changed);
  const overStock = cart.items.some((item) => {
    const product = products.find((p) => p.id === item.reward_id);
    return !product || (product.stock !== null && cart.items.filter((line) => line.reward_id === item.reward_id).reduce((sum,line) => sum + line.quantity,0) > product.stock);
  });
  const changePayment = (item: CartLine, mode: PriceMode) => {
    const product = products.find((p) => p.id === item.reward_id);
    const price = product && productPrices(product).find((p) => p.mode === mode);
    if (!price) return;
    const rest = cart.items.filter((row) => row !== item);
    const other = rest.find((row) => row.reward_id === item.reward_id && row.mode === mode);
    if (other && other.quantity + item.quantity > 99) { toast.error("Limite de 99 unidades por modalidade."); return; }
    update(other ? rest.map((row) => row === other ? { ...row, quantity: row.quantity + item.quantity, expected_cash: price.cash, expected_coins: price.coins } : row) : [...rest,{ ...item,mode,expected_cash:price.cash,expected_coins:price.coins }]);
  };
  const checkout = () => {
    if (!purchasesEnabled || freightLoading || freightError || freightBlocked || (hasPhysical&&!freightQuote)) return;
    if (submitting.current) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await checkoutStoreAction({...cart,voucherId:selectedVoucher||null,expectedFreight:freight});
        if (!result.ok) { toast.error(result.error); setFreightRevision(n=>n+1);router.refresh(); return; }
        dispatch(emptyCart);setSelectedVoucher("");
        try { localStorage.removeItem(storageKey); } catch { /* Sem impacto no pedido salvo. */ }
        setOpen(false);
        toast.success(Number(result.data.cash_total) > 0 ? "Pedido salvo. Pague o Pix para confirmar." : "Compra confirmada!");
        router.refresh();
        document.getElementById("pedidos-loja")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch { toast.error("A conexão falhou. Tente novamente; seu carrinho foi mantido para evitar pedidos duplicados."); }
      finally { submitting.current = false; }
    });
  };
  const categoryHref=(category:string)=>{const params=new URLSearchParams();if(category)params.set('category',category);return `/painel/loja${params.size?`?${params}`:''}`;};
  return <div className="min-w-0"><section className="grid gap-6" aria-labelledby="catalogo-loja">
    <StoreSearch query={catalogFilters.q}><Button onClick={()=>openCart()} variant="outline" className="h-12"><ShoppingCart/><span className="hidden sm:inline">Carrinho</span><span className="rounded-full bg-amarelo/20 px-2 text-xs">{totals.quantity}</span></Button></StoreSearch>
    <nav aria-label="Categorias de produtos" className="flex gap-2 overflow-x-auto pb-1">{['',...catalog.categories].map(category=><Link key={category} href={categoryHref(category)} aria-current={catalogFilters.category===category?'page':undefined} className={`shrink-0 rounded-full border px-4 py-2.5 text-xs font-medium ${catalogFilters.category===category?'border-ouro/30 bg-amarelo/15 text-ouro-ink':'bg-card text-muted-foreground hover:text-foreground'}`}>{category||'Todos os produtos'}</Link>)}</nav>
    <StoreHero banner={banner} productImages={rewards.filter(p=>p.image_path).slice(0,3).map(p=>({path:p.image_path!,name:p.name}))}/>
    <div id="catalogo-loja" className="scroll-mt-24"><p className="mb-2 text-[11px] text-muted-foreground">Loja / {catalogFilters.category||'Todos os produtos'}</p><h2 className="mb-5 text-2xl font-bold tracking-tight sm:text-3xl">Explore a loja</h2><StoreCatalogControls filters={catalogFilters} categories={catalog.categories} total={catalog.total}>
    {rewards.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">{rewards.map((product)=><ProductCard key={product.id} product={product} onAdd={add} purchasesEnabled={purchasesEnabled}/>)}</div> : <div className="rounded-2xl border border-dashed px-5 py-12 text-center"><Search className="mx-auto mb-3 size-8 text-muted-foreground"/><p className="font-semibold">Nenhum produto encontrado</p><p className="mt-2 text-sm text-muted-foreground">Tente outra busca ou ajuste os filtros.</p><Link href="/painel/loja" className="mt-4 inline-block text-sm underline">Ver todos os produtos</Link></div>}
    </StoreCatalogControls></div>
    {cart.items.length > 0 && <Button onClick={() => openCart()} className="sticky bottom-24 z-20 flex h-auto justify-between gap-3 rounded-xl p-4 shadow-lg"><span className="flex items-center gap-2"><ShoppingCart /> Ver carrinho ({totals.quantity})</span><span className="text-right text-xs">{priceLabel(totals.cash / 100, totals.coins / 100)}</span></Button>}
    <Sheet open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}><SheetContent className="flex min-h-0 flex-col gap-0 overflow-hidden p-0 data-[side=right]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-lg"><SheetHeader className="shrink-0 border-b px-4 py-4 pr-12"><SheetTitle className="flex items-center gap-2"><ShoppingCart className="size-5"/> Seu carrinho</SheetTitle><SheetDescription className="text-xs">{totals.quantity} {totals.quantity===1?"item":"itens"} · confira antes de confirmar.</SheetDescription></SheetHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {cart.items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Seu carrinho está vazio.</p>}
        {cart.items.map((item) => { const product = products.find((p) => p.id === item.reward_id); return <div key={`${item.reward_id}-${item.mode}`} className="rounded-xl border p-3"><div className="flex items-start gap-3">{product?.image_path&&<Image src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${product.image_path}`} alt="" width={56} height={56} className="size-12 shrink-0 rounded-lg border bg-white object-contain p-1 sm:size-14"/>}<div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold leading-snug">{product?.name ?? "Produto indisponível"}</p><p className="mt-1 text-xs text-ouro-ink">{priceLabel(item.expected_cash,item.expected_coins)} / unidade</p><p className="mt-1 text-[11px] text-muted-foreground">{item.mode==='cash'?'Pagamento via Pix':'Resgate com Caracoins'}</p></div><Button variant="ghost" size="icon" disabled={pending} aria-label={`Remover ${product?.name ?? "produto"}`} onClick={() => update(cart.items.filter((row) => row !== item))}><Trash2 className="size-4" /></Button></div>

          {changed(item) && currentPrice(item) && <Button size="sm" variant="outline" disabled={pending} className="mt-2" onClick={() => changePayment(item,item.mode)}>Aceitar preço atualizado</Button>}
          <div className="mt-3 flex flex-wrap items-center gap-2"><Button size="icon" variant="outline" disabled={pending} className="size-9 shrink-0" aria-label="Diminuir quantidade" onClick={() => update(cart.items.flatMap((row) => row !== item ? [row] : row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : []))}><Minus className="size-4" /></Button><span className="tabular-nums">{item.quantity}</span><Button size="icon" variant="outline" disabled={pending || !product} className="size-9 shrink-0" aria-label="Aumentar quantidade" onClick={() => product && add(product,item.mode)}><Plus className="size-4" /></Button><p className="ml-auto max-w-full break-words text-right text-xs font-semibold">{priceLabel(item.expected_cash * item.quantity,item.expected_coins * item.quantity)}</p></div></div>; })}
        {totals.coins>0&&<div className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/40 p-3 text-xs"><span>Saldo disponível</span><span className="flex items-center gap-1"><Coins className="size-3.5 text-ouro-ink"/>{coinNumber(balance)} Caracoins</span></div>}
        {missing > 0 && <p role="alert" className="text-sm text-destructive">Faltam {coinNumber(missing)} Caracoins para este resgate.</p>}
        {cartLoading && <p role="status" className="text-sm text-muted-foreground">Atualizando os itens do carrinho…</p>}
        {totals.cash>0 && <div className="grid gap-2 rounded-xl border p-3"><label className="grid gap-2 text-sm">Aplicar voucher<select value={selectedVoucher} disabled={pending} onChange={event=>{setSelectedVoucher(event.target.value);update(cart.items);}} className="min-w-0 rounded-lg border bg-background p-2"><option value="">Sem voucher</option>{vouchers.map(v=><option key={v.id} value={v.id}>{v.name} · {storeBRL(Number(v.discount_cash))}</option>)}</select></label>{selectedVoucher && !discount && <p role="alert" className="text-xs text-destructive">Este carrinho não atende às regras ou à validade do voucher.</p>}{discount>0&&<p className="text-sm text-emerald-700">Desconto aplicado: −{storeBRL(discount/100)}. Subtotal dos produtos: {storeBRL(totals.cash/100)}.</p>}<Link href="/painel/loja?tab=vouchers" className="text-xs underline">Resgatar vouchers com Caracoins</Link></div>}
        {cartError && <div role="alert" className="grid gap-2 text-sm text-destructive"><p>{cartError}</p><Button variant="outline" onClick={()=>setRetryCart(n=>n+1)}>Tentar novamente</Button></div>}
        {hasOpenOrder && <p className="text-sm text-muted-foreground">Você já tem um pedido aguardando Pix. Conclua ou cancele esse pagamento para comprar novamente.</p>}
        {(hasStaleItems || overStock) && <p role="alert" className="text-sm text-destructive">O catálogo mudou. Confira os preços atualizados e reduza ou remova os itens sem estoque antes de confirmar.</p>}
        {cart.items.length>0&&<div className="space-y-3 border-t pt-3 text-xs text-muted-foreground"><div className="grid gap-2"><div className="flex justify-between gap-3"><span>Produtos</span><span>{priceLabel(totals.cash/100,totals.coins/100)}</span></div>{discount>0&&<div className="flex justify-between gap-3 text-emerald-700"><span>Voucher</span><span>−{storeBRL(discount/100)}</span></div>}<div className="flex justify-between gap-3"><span>Frete do pacote</span><strong className="text-right text-foreground">{!hasPhysical?'Sem envio físico':freightLoading?'Conferindo…':freightError?'Indisponível':freightBlocked?'Pix já pendente':freightQuote?.status==='paid'?'Já pago · R$ 0,00':storeBRL(freight)}</strong></div></div>
        {hasPhysical&&freightQuote?.status==='paid'&&<p>Encontramos um frete pago e disponível. Ele será aproveitado neste pacote, sem nova cobrança.</p>}
        {hasPhysical&&freightQuote?.status==='due'&&<p>Os R$ 20 do frete serão incluídos neste mesmo Pix. Um único frete para os produtos e lotes enviados no pacote.</p>}
        {freightBlocked&&<p role="alert">O frete tem pagamento pendente ou em análise: {freightQuote?.code}. <Link href={freightQuote?.source==='store'?'/painel/loja?tab=orders':'/painel/pix'} className="font-semibold underline">Confira esse pagamento</Link> antes de confirmar outra compra.</p>}
        {freightError&&<div role="alert" className="grid gap-2 text-destructive"><p>{freightError}</p><Button variant="outline" size="sm" disabled={pending} onClick={()=>setFreightRevision(n=>n+1)}>Conferir frete novamente</Button></div>}
        <details><summary className="cursor-pointer font-medium text-foreground">Como funcionam o pagamento e o voucher?</summary><p className="mt-2 leading-relaxed">{totals.cash>0?'O voucher desconta somente produtos, nunca o frete. Fica reservado até a confirmação. Se o pedido for cancelado antes do pagamento, ele volta à carteira com a validade original.':'As Caracoins dos produtos ficam reservadas ao confirmar. Se houver frete a pagar, ele será cobrado em reais neste Pix.'}</p></details></div>}
      </div>
      <div className="shrink-0 space-y-3 border-t bg-background px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]"><div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">Total a pagar</span><strong aria-live="polite" className="min-w-0 break-words text-right text-lg text-ouro-ink">{freightLoading?'Conferindo…':freightError||freightBlocked?'—':cart.items.length?priceLabel(cashDue/100,totals.coins/100):'—'}</strong></div>
        <Button className="min-h-11 w-full whitespace-normal px-3 text-sm leading-snug" disabled={!purchasesEnabled || pending || freightLoading || !!freightError || freightBlocked || (hasPhysical&&!freightQuote) || cartLoading || !!cartError || !cart.items.length || missing > 0 || hasOpenOrder || hasStaleItems || overStock || (!!selectedVoucher && !discount)} onClick={checkout}>{pending ? "Preparando pedido…" : freightLoading ? "Conferindo frete…" : freightBlocked||freightError ? "Confira o frete" : cashDue>0 ? `Gerar Pix de ${storeBRL(cashDue / 100)}` : totals.cash>0 ? "Confirmar compra com voucher" : "Confirmar compra com Caracoins"}</Button>
      </div>
    </SheetContent></Sheet>
  </section></div>;
}
