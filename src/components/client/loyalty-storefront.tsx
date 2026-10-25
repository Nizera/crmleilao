"use client";

import Image from "next/image";
import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Coins, Gift, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { checkoutStoreAction } from "@/app/actions/store";
import { cartCheckoutSchema, cartTotals, coinNumber, priceLabel, productPrices, storeBRL, type CartLine, type PriceMode, type StoreProduct } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type Cart = { items: CartLine[]; requestKey: string };
const emptyCart: Cart = { items: [], requestKey: "" };
function ProductCard({ product, onAdd }: { product: StoreProduct; onAdd: (product: StoreProduct, mode: PriceMode) => void }) {
  const options = productPrices(product);
  const [mode, setMode] = useState<PriceMode>(options[0]?.mode ?? "coins");
  const [details,setDetails]=useState(false);
  const [photoIndex,setPhotoIndex]=useState(0);
  const gallery=product.image_paths?.length?product.image_paths:product.image_path?[product.image_path]:[];
  const photoUrl=(path:string)=>`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${path}`;
  const price = options.find((option) => option.mode === mode) ?? options[0];
  const imageUrl = product.image_path ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/lot-images/${product.image_path}` : null;
  return <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
    <button type="button" aria-label={`Ver fotos e detalhes de ${product.name}`} onClick={()=>setDetails(true)} className="relative block aspect-square w-full bg-white">
      {imageUrl ? <Image src={imageUrl} alt={product.name} fill sizes="(max-width: 640px) 45vw, 300px" className="object-contain p-4 transition-transform group-hover:scale-105" /> : <Gift className="absolute inset-0 m-auto size-12 text-amber-600" />}
      {product.stock === 0 && <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-xs text-white">Esgotado</span>}
      {product.stock !== null && product.stock > 0 && product.stock <= 5 && <span className="absolute left-2 top-2 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900">Últimas unidades</span>}
      {gallery.length>1 && <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white">{gallery.length} fotos</span>}
    </button>
    <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
      <div><h3 className="line-clamp-2 text-sm font-semibold sm:text-base">{product.name}</h3>{product.description && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{product.description}</p>}</div>
      <div className="mt-auto grid gap-2">
        {options.length > 1 && <label className="grid gap-1 text-[11px] text-muted-foreground">Como pagar<select aria-label={`Pagamento de ${product.name}`} value={price?.mode} onChange={(event) => setMode(event.target.value as PriceMode)} className="min-w-0 rounded-lg border bg-background px-2 py-2 text-xs text-foreground">{options.map((option) => <option key={option.mode} value={option.mode}>{option.mode === "coins" ? "Caracoins" : option.mode === "cash" ? "Reais (Pix)" : "Reais + Caracoins"}</option>)}</select></label>}
        <p className="min-h-10 text-sm font-bold leading-snug text-ouro-ink sm:text-base">{price ? priceLabel(price.cash, price.coins) : "Em breve"}</p>
        <Button size="sm" className="w-full text-xs sm:text-sm" disabled={!price || product.stock === 0} onClick={() => price && onAdd(product, price.mode)}><Plus className="size-3.5" /> Adicionar</Button>
      </div>
    </div>
    <Sheet open={details} onOpenChange={setDetails}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg"><SheetHeader><SheetTitle>{product.name}</SheetTitle><SheetDescription>{product.category || "Produto da loja"}{product.sku?` · ${product.sku}`:""}</SheetDescription></SheetHeader><div className="grid gap-4 p-4">
      {gallery.length>0 && <><div className="relative aspect-square rounded-xl bg-white"><Image src={photoUrl(gallery[Math.min(photoIndex,gallery.length-1)])} alt={product.name} fill sizes="(max-width:640px) 90vw,440px" className="object-contain p-3" /></div>{gallery.length>1 && <div className="flex flex-wrap gap-2">{gallery.map((path,index)=><button type="button" key={path} aria-label={`Ver foto ${index+1}`} aria-pressed={photoIndex===index} onClick={()=>setPhotoIndex(index)} className={`overflow-hidden rounded-lg border ${photoIndex===index?"border-ouro ring-1 ring-ouro":""}`}><Image src={photoUrl(path)} alt="" width={64} height={64} className="size-16 bg-white object-contain p-1" /></button>)}</div>}</>}
      {product.description && <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{product.description}</p>}
      {options.length>1 && <label className="grid gap-2 text-sm">Forma de pagamento<select aria-label={`Pagamento nos detalhes de ${product.name}`} value={price?.mode} onChange={(event)=>setMode(event.target.value as PriceMode)} className="rounded-lg border bg-background p-3">{options.map((option)=><option key={option.mode} value={option.mode}>{priceLabel(option.cash,option.coins)}</option>)}</select></label>}
      <p className="font-bold text-ouro-ink">{price?priceLabel(price.cash,price.coins):"Preço a definir"}</p><Button disabled={!price || product.stock===0} onClick={()=>{if(price){onAdd(product,price.mode);setDetails(false);}}}><Plus />Adicionar ao carrinho</Button>
    </div></SheetContent></Sheet>
  </article>;
}

export function LoyaltyStorefront({ rewards, balance, customerId, hasOpenOrder }: { rewards: StoreProduct[]; balance: number; customerId: string; hasOpenOrder: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("newest");
  const [open, setOpen] = useState(false);
  const [cart, dispatch] = useReducer((_: Cart, next: Cart) => next, emptyCart);
  const [pending, startTransition] = useTransition();
  const submitting = useRef(false);
  const storageKey = `ocdl-store-cart-v1:${customerId}`;
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      const parsed = cartCheckoutSchema.safeParse(saved);
      if (parsed.success) dispatch(parsed.data);
    } catch { /* Carrinho local inválido: começa vazio. */ }
  }, [storageKey]);
  const update = (items: CartLine[]) => {
    const next = { items, requestKey: crypto.randomUUID() };
    dispatch(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Carrinho continua disponível nesta aba. */ }
  };
  const add = (product: StoreProduct, mode: PriceMode) => {
    const price = productPrices(product).find((option) => option.mode === mode);
    if (!price) return;
    const quantity = cart.items.filter((item) => item.reward_id === product.id).reduce((sum, item) => sum + item.quantity, 0);
    if (product.stock !== null && quantity >= product.stock) { toast.error("Você já adicionou o estoque disponível deste produto."); return; }
    const existing = cart.items.find((item) => item.reward_id === product.id && item.mode === mode);
    if (existing && existing.quantity >= 99) return;
    if (!existing && cart.items.length >= 50) { toast.error("O carrinho aceita até 50 combinações de produtos."); return; }
    update(existing ? cart.items.map((item) => item === existing ? { ...item, quantity: item.quantity + 1 } : item) : [...cart.items, { reward_id: product.id, mode, quantity: 1, expected_cash: price.cash, expected_coins: price.coins }]);
    toast.success("Adicionado ao carrinho", { action: { label: "Ver carrinho", onClick: () => setOpen(true) } });
  };
  const totals = cartTotals(cart.items);
  const missing = totals.coins > 0 ? Math.max(0, totals.coins / 100 - balance) : 0;
  const currentPrice = (item: CartLine) => { const product = rewards.find((p) => p.id === item.reward_id); return product ? productPrices(product).find((price) => price.mode === item.mode) : undefined; };
  const changed = (item: CartLine) => { const price = currentPrice(item); return !price || price.cash !== item.expected_cash || price.coins !== item.expected_coins; };
  const hasStaleItems = cart.items.some(changed);
  const overStock = cart.items.some((item) => {
    const product = rewards.find((p) => p.id === item.reward_id);
    return !product || (product.stock !== null && cart.items.filter((line) => line.reward_id === item.reward_id).reduce((sum,line) => sum + line.quantity,0) > product.stock);
  });
  const changePayment = (item: CartLine, mode: PriceMode) => {
    const product = rewards.find((p) => p.id === item.reward_id);
    const price = product && productPrices(product).find((p) => p.mode === mode);
    if (!price) return;
    const rest = cart.items.filter((row) => row !== item);
    const other = rest.find((row) => row.reward_id === item.reward_id && row.mode === mode);
    if (other && other.quantity + item.quantity > 99) { toast.error("Limite de 99 unidades por modalidade."); return; }
    update(other ? rest.map((row) => row === other ? { ...row, quantity: row.quantity + item.quantity, expected_cash: price.cash, expected_coins: price.coins } : row) : [...rest,{ ...item,mode,expected_cash:price.cash,expected_coins:price.coins }]);
  };
  const filtered = useMemo(() => {
    const result = rewards.filter((product) => {
      const matches = `${product.name} ${product.description ?? ""}`.toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"));
      return matches && (filter === "all" || productPrices(product).some((price) => price.mode === filter));
    });
    if (sort !== "newest") result.sort((a,b) => {
      const mode = sort === "cash" ? "cash" : "coins";
      const cost = (product: StoreProduct) => { const price = productPrices(product).find((p) => p.mode === mode); return price ? (mode === "cash" ? price.cash : price.coins) : Infinity; };
      return cost(a) - cost(b);
    });
    return result;
  }, [rewards, query, filter, sort]);
  const checkout = () => {
    if (submitting.current) return;
    submitting.current = true;
    startTransition(async () => {
      try {
        const result = await checkoutStoreAction(cart);
        if (!result.ok) { toast.error(result.error); router.refresh(); return; }
        dispatch(emptyCart);
        try { localStorage.removeItem(storageKey); } catch { /* Sem impacto no pedido salvo. */ }
        setOpen(false);
        toast.success(Number(result.data.cash_total) > 0 ? "Pedido salvo. Pague o Pix para confirmar." : "Compra confirmada com suas Caracoins!");
        router.refresh();
        document.getElementById("pedidos-loja")?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch { toast.error("A conexão falhou. Tente novamente; seu carrinho foi mantido para evitar pedidos duplicados."); }
      finally { submitting.current = false; }
    });
  };
  return <section className="grid gap-4" aria-labelledby="catalogo-loja">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-ouro-ink">Explore e aproveite</p><h2 id="catalogo-loja" className="text-xl font-bold">Produtos da loja</h2></div><Button onClick={() => setOpen(true)} variant="outline"><ShoppingCart /> Carrinho <span className="rounded-full bg-amarelo/20 px-2 text-xs">{totals.quantity}</span></Button></div>
    <label className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><input aria-label="Buscar produtos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="O que você procura?" className="h-11 w-full rounded-xl border bg-background pl-10 pr-3 text-sm" /></label>
    <div className="flex flex-wrap gap-2">{[["all","Todos"],["coins","Caracoins"],["cash","Reais"],["mixed","Reais + Caracoins"]].map(([key,label]) => <button type="button" key={key} onClick={() => setFilter(key)} aria-pressed={filter === key} className={`rounded-full border px-3 py-1.5 text-xs ${filter === key ? "border-ouro bg-amarelo/15 font-semibold text-ouro-ink" : "text-muted-foreground"}`}>{label}</button>)}<select aria-label="Ordenar produtos" value={sort} onChange={(event) => setSort(event.target.value)} className="ml-auto rounded-lg border bg-background p-1.5 text-xs"><option value="newest">Novidades</option><option value="cash">Menor preço em reais</option><option value="coins">Menos Caracoins</option></select></div>
    {filtered.length ? <div className="grid grid-cols-2 gap-3 sm:gap-4">{filtered.map((product) => <ProductCard key={product.id} product={product} onAdd={add} />)}</div> : <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</p>}
    {cart.items.length > 0 && <Button onClick={() => setOpen(true)} className="sticky bottom-24 z-20 flex h-auto justify-between gap-3 rounded-xl p-4 shadow-lg"><span className="flex items-center gap-2"><ShoppingCart /> Ver carrinho ({totals.quantity})</span><span className="text-right text-xs">{priceLabel(totals.cash / 100, totals.coins / 100)}</span></Button>}
    <Sheet open={open} onOpenChange={(value) => { if (!pending) setOpen(value); }}><SheetContent className="flex flex-col data-[side=right]:w-full data-[side=right]:sm:max-w-lg"><SheetHeader><SheetTitle className="flex items-center gap-2"><ShoppingCart /> Seu carrinho</SheetTitle><SheetDescription>Revise os itens e a forma de pagamento de cada produto.</SheetDescription></SheetHeader>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {cart.items.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Seu carrinho está vazio.</p>}
        {cart.items.map((item) => { const product = rewards.find((p) => p.id === item.reward_id); return <div key={`${item.reward_id}-${item.mode}`} className="rounded-xl border p-3"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{product?.name ?? "Produto indisponível"}</p><p className="text-xs text-ouro-ink">{priceLabel(item.expected_cash,item.expected_coins)} / unidade</p></div><Button variant="ghost" size="icon" disabled={pending} aria-label={`Remover ${product?.name ?? "produto"}`} onClick={() => update(cart.items.filter((row) => row !== item))}><Trash2 className="size-4" /></Button></div>
          {product && <select aria-label={`Forma de pagamento de ${product.name} no carrinho`} disabled={pending} value={item.mode} onChange={(event) => changePayment(item,event.target.value as PriceMode)} className="mt-2 w-full rounded-lg border bg-background p-2 text-xs">{!currentPrice(item) && <option value={item.mode}>Modalidade indisponível</option>}{productPrices(product).map((price) => <option key={price.mode} value={price.mode}>{priceLabel(price.cash,price.coins)}</option>)}</select>}
          {changed(item) && currentPrice(item) && <Button size="sm" variant="outline" disabled={pending} className="mt-2" onClick={() => changePayment(item,item.mode)}>Aceitar preço atualizado</Button>}
          <div className="mt-3 flex items-center gap-3"><Button size="icon" variant="outline" disabled={pending} aria-label="Diminuir quantidade" onClick={() => update(cart.items.flatMap((row) => row !== item ? [row] : row.quantity > 1 ? [{ ...row, quantity: row.quantity - 1 }] : []))}><Minus className="size-4" /></Button><span className="tabular-nums">{item.quantity}</span><Button size="icon" variant="outline" disabled={pending || !product} aria-label="Aumentar quantidade" onClick={() => product && add(product,item.mode)}><Plus className="size-4" /></Button><p className="ml-auto text-right text-xs font-semibold">{priceLabel(item.expected_cash * item.quantity,item.expected_coins * item.quantity)}</p></div></div>; })}
      </div>
      <div className="space-y-3 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><div className="flex justify-between text-sm"><span>Disponível</span><span className="flex items-center gap-1"><Coins className="size-4 text-ouro-ink" />{coinNumber(balance)} Caracoins</span></div><div className="flex justify-between gap-3 font-bold"><span>Total</span><span className="text-right text-ouro-ink">{cart.items.length ? priceLabel(totals.cash / 100,totals.coins / 100) : "—"}</span></div>
        {missing > 0 && <p role="alert" className="text-sm text-destructive">Faltam {coinNumber(missing)} Caracoins. Escolha a opção em reais nos produtos que oferecem essa modalidade.</p>}
        {hasOpenOrder && <p className="text-sm text-muted-foreground">Você já tem um pedido aguardando Pix. Conclua ou cancele esse pagamento para comprar novamente.</p>}
        {(hasStaleItems || overStock) && <p role="alert" className="text-sm text-destructive">O catálogo mudou. Confira os preços atualizados e reduza ou remova os itens sem estoque antes de confirmar.</p>}
        <p className="text-xs text-muted-foreground">{totals.cash > 0 ? "O valor em reais será pago em um único Pix. As Caracoins ficam reservadas até a confirmação; se o pagamento expirar ou for cancelado, elas voltam ao saldo." : "As Caracoins serão descontadas ao confirmar a compra."} A equipe acompanha a entrega ou utilização dos itens.</p>
        <Button className="w-full" disabled={pending || !cart.items.length || missing > 0 || hasOpenOrder || hasStaleItems || overStock} onClick={checkout}>{pending ? "Preparando pedido…" : totals.cash > 0 ? `Gerar Pix de ${storeBRL(totals.cash / 100)}` : "Confirmar compra com Caracoins"}</Button>
      </div>
    </SheetContent></Sheet>
  </section>;
}
