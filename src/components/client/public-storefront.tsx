"use client";
import { StoreCartSuggestions } from '@/components/client/store-cart-suggestions';
import {trackStoreProduct} from '@/lib/meta-browser';
import { useSyncExternalStore } from "react";
import Link from "next/link";
import Image from "next/image";
import { storeProductImageUrl } from "@/lib/store-presentation";
import { WEEKLY_FREIGHT } from "@/lib/freight";
import { formatDateBR } from "@/lib/lots";
import { ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProductCard } from "@/components/client/loyalty-storefront";
import { StoreCatalogControls } from "@/components/client/store-catalog-controls";
import { StoreQuickFilters, StoreSearch } from "@/components/client/store-search";
import { StoreHero } from "@/components/client/store-hero";
import { Button } from "@/components/ui/button";
import type { CustomerCatalog } from "@/lib/loyalty-history";
import type { CatalogFilters, StoreBanner } from "@/lib/store-presentation";
import { publicCartSchema, cartTotals, priceLabel, productPrices, storeBRL, type PublicCartLine, type StoreProduct, type PriceMode } from "@/lib/store";
import { commerceLoginHref, PUBLIC_CART_KEY } from "@/lib/commerce-access";
const subscribeCart=(notify:()=>void)=>{window.addEventListener('ocdl-public-cart-change',notify);window.addEventListener('storage',notify);return()=>{window.removeEventListener('ocdl-public-cart-change',notify);window.removeEventListener('storage',notify);};};
const cartSnapshot=()=>{try{return sessionStorage.getItem(PUBLIC_CART_KEY);}catch{return null;}};
export function PublicStorefront({catalog,filters,banner,shippingDate,detail}:{detail?:StoreProduct;shippingDate:string|null;catalog:CustomerCatalog;filters:CatalogFilters;banner?:Partial<StoreBanner>|null}){
 const raw=useSyncExternalStore(subscribeCart,cartSnapshot,()=>null);
 let items:PublicCartLine[]=[];try{const parsed=publicCartSchema.safeParse(JSON.parse(raw??'null'));if(parsed.success)items=parsed.data.items;}catch{}
 function save(next:PublicCartLine[]){try{if(next.length)sessionStorage.setItem(PUBLIC_CART_KEY,JSON.stringify({items:next,requestKey:crypto.randomUUID()}));else sessionStorage.removeItem(PUBLIC_CART_KEY);window.dispatchEvent(new Event("ocdl-public-cart-change"));}catch{toast.error('Seu navegador n�o permitiu salvar a sele��o. Mantenha esta tela aberta.');}}
 function add(product:StoreProduct,mode:PriceMode){const price=productPrices(product).find(p=>p.mode===mode);if(!price||mode==="mixed")return;const old=items.find(i=>i.reward_id===product.id&&i.mode===mode);if((old?.quantity??0)>=Math.min(99,product.stock??99)){toast.error('Quantidade m�xima dispon�vel atingida.');return;}const next=old?items.map(i=>i===old?{...i,quantity:i.quantity+1}:i):[...items,{reward_id:product.id,quantity:1,mode,expected_cash:price.cash,expected_coins:price.coins,delivery_kind:product.delivery_kind}];if(next.length>50){toast.error('Limite de 50 itens por carrinho.');return;}save(next);trackStoreProduct('AddToCart',product);toast.success('Adicionado � sua sele��o.');}
 const totals=cartTotals(items);
 const hasPhysical = items.some(item => (catalog.items.find(product => product.id === item.reward_id)?.delivery_kind ?? item.delivery_kind) !== 'digital');
 const initialFreight = hasPhysical ? WEEKLY_FREIGHT : 0;
 return <div className="grid min-w-0 gap-5">{detail ? <PublicProductDetail product={detail} onAdd={add}/> : <><StoreSearch path="/loja" filters={filters}/><StoreQuickFilters path="/loja" filters={filters} categories={catalog.categories}/><StoreHero publicView showCopa={catalog.categories.includes("COPA 2026")} banner={banner} productImages={catalog.items.filter(p=>p.image_path).slice(0,3).map(p=>({path:p.image_path!,name:p.name}))}/><div id="catalogo-loja"><StoreCatalogControls path="/loja" filters={filters} categories={catalog.categories} total={catalog.total}>{catalog.items.length?<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{catalog.items.map(product=><ProductCard key={product.id} product={product} purchasesEnabled onAdd={add}/>)}</div>:<p className="rounded-xl border p-8 text-center text-sm">Nenhum produto encontrado. Tente outra busca.</p>}</StoreCatalogControls></div></>}{items.length>0&&<StoreCartSuggestions items={items} onAdd={add} disabled={items.length >= 50}/>} {items.length>0&&<section aria-label="Sua sele��o" className="sticky bottom-3 z-20 grid gap-3 rounded-2xl border bg-card p-4 shadow-lg"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 font-semibold"><ShoppingCart size={18}/>{totals.quantity} {totals.quantity === 1 ? "item" : "itens"}</span><Button variant="ghost" size="sm" onClick={()=>save([])}><Trash2 size={14}/>Limpar</Button></div><dl className="grid gap-1.5 text-sm">
   <div className="flex justify-between gap-3"><dt>Subtotal dos produtos</dt><dd>{priceLabel(totals.cash/100,totals.coins/100)}</dd></div>
   <div className="flex justify-between gap-3"><dt>Frete estimado</dt><dd>{hasPhysical ? storeBRL(initialFreight) : 'Sem envio f�sico'}</dd></div>
   {hasPhysical && shippingDate && <div className="flex justify-between gap-3"><dt>Pr�ximo envio previsto</dt><dd>{formatDateBR(shippingDate)}</dd></div>}
   <div className="flex justify-between gap-3 border-t pt-1.5 font-semibold"><dt>Total estimado</dt><dd>{priceLabel(totals.cash/100+initialFreight,totals.coins/100)}</dd></div>
 </dl>
 {hasPhysical && <p className="text-xs text-muted-foreground">Um frete por pacote. Ao entrar, conferimos se h� frete pago dispon�vel para aproveitar no envio dos produtos e lotes.</p>}
 <Button asChild><Link href={commerceLoginHref('/painel/loja?resume=cart')}>Entrar ou criar conta para comprar</Link></Button>
 <p className="text-xs text-muted-foreground">Vouchers s�o aplicados no carrinho ap�s o login. A sele��o n�o reserva estoque.</p></section>}</div>;
}

function PublicProductDetail({ product, onAdd }: {
  product: StoreProduct;
  onAdd: (product: StoreProduct, mode: PriceMode) => void;
}) {
  const image = product.image_path ?? product.image_paths?.[0];
  const available = product.stock === null || product.stock > 0;
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success("Link copiado.");
    } catch {
      toast.error("Copie o link pela barra de endere�o.");
    }
  }

  return (
    <article className="grid gap-5 rounded-2xl border bg-card p-4 md:grid-cols-2 md:p-6">
      {image && <div className="relative aspect-square overflow-hidden rounded-xl bg-white">
        <Image src={storeProductImageUrl(image)} alt={product.name} fill loading="eager"
          fetchPriority="high" sizes="(max-width: 767px) 90vw, 540px" className="object-contain p-4" />
      </div>}
      <div className="grid content-start gap-4">
        {product.category && <p className="text-sm text-muted-foreground">{product.category}</p>}
        <h1 className="text-2xl font-bold">{product.name}</h1>
        {product.description && <p className="whitespace-pre-line text-sm">{product.description}</p>}
        {productPrices(product).map(price => (
          <div key={price.mode} className="grid justify-items-start gap-2">
            <p className="text-xl font-semibold">{priceLabel(price.cash, price.coins)}</p>
            <Button disabled={!available} onClick={() => onAdd(product, price.mode)}>
              {available ? "Adicionar ao carrinho" : "Esgotado"}
            </Button>
          </div>
        ))}
        <Button variant="outline" className="w-fit" onClick={copyLink}>Copiar link</Button>
      </div>
    </article>
  );
}

