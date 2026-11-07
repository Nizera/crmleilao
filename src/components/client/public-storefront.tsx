"use client";
import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ProductCard } from "@/components/client/loyalty-storefront";
import { StoreCatalogControls } from "@/components/client/store-catalog-controls";
import { StoreSearch } from "@/components/client/store-search";
import { StoreHero } from "@/components/client/store-hero";
import { Button } from "@/components/ui/button";
import type { CustomerCatalog } from "@/lib/loyalty-history";
import type { CatalogFilters, StoreBanner } from "@/lib/store-presentation";
import { cartCheckoutSchema, cartTotals, priceLabel, productPrices, type CartLine, type StoreProduct, type PriceMode } from "@/lib/store";
import { commerceLoginHref, PUBLIC_CART_KEY } from "@/lib/commerce-access";
const subscribeCart=(notify:()=>void)=>{window.addEventListener('ocdl-public-cart-change',notify);window.addEventListener('storage',notify);return()=>{window.removeEventListener('ocdl-public-cart-change',notify);window.removeEventListener('storage',notify);};};
const cartSnapshot=()=>{try{return sessionStorage.getItem(PUBLIC_CART_KEY);}catch{return null;}};
export function PublicStorefront({catalog,filters,banner}:{catalog:CustomerCatalog;filters:CatalogFilters;banner?:Partial<StoreBanner>|null}){
 const router=useRouter();const raw=useSyncExternalStore(subscribeCart,cartSnapshot,()=>null);
 let items:CartLine[]=[];try{const parsed=cartCheckoutSchema.safeParse(JSON.parse(raw??'null'));if(parsed.success)items=parsed.data.items;}catch{}
 function save(next:CartLine[]){try{if(next.length)sessionStorage.setItem(PUBLIC_CART_KEY,JSON.stringify({items:next,requestKey:crypto.randomUUID()}));else sessionStorage.removeItem(PUBLIC_CART_KEY);window.dispatchEvent(new Event("ocdl-public-cart-change"));}catch{toast.error('Seu navegador não permitiu salvar a seleção. Mantenha esta tela aberta.');}}
 function add(product:StoreProduct,mode:PriceMode){const price=productPrices(product).find(p=>p.mode===mode);if(!price)return;const old=items.find(i=>i.reward_id===product.id&&i.mode===mode);if((old?.quantity??0)>=Math.min(99,product.stock??99)){toast.error('Quantidade máxima disponível atingida.');return;}const next=old?items.map(i=>i===old?{...i,quantity:i.quantity+1}:i):[...items,{reward_id:product.id,quantity:1,mode,expected_cash:price.cash,expected_coins:price.coins}];if(next.length>50){toast.error('Limite de 50 itens por carrinho.');return;}save(next);toast.success('Adicionado à sua seleção.');}
 const totals=cartTotals(items);
 return <div className="grid min-w-0 gap-5"><StoreHero banner={banner} productImages={catalog.items.filter(p=>p.image_path).slice(0,3).map(p=>({path:p.image_path!,name:p.name}))}/><StoreSearch path="/loja" query={filters.q}/><div id="catalogo-loja"><StoreCatalogControls path="/loja" filters={filters} categories={catalog.categories} total={catalog.total}>{catalog.items.length?<div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{catalog.items.map(product=><ProductCard key={product.id} product={product} purchasesEnabled onAdd={add}/>)}</div>:<p className="rounded-xl border p-8 text-center text-sm">Nenhum produto encontrado. Tente outra busca.</p>}</StoreCatalogControls></div>{items.length>0&&<section aria-label="Sua seleção" className="sticky bottom-3 z-20 grid gap-3 rounded-2xl border bg-card p-4 shadow-lg"><div className="flex flex-wrap items-center justify-between gap-3"><span className="flex items-center gap-2 font-semibold"><ShoppingCart size={18}/>{totals.quantity} item(ns) · {priceLabel(totals.cash/100,totals.coins/100)}</span><Button variant="ghost" size="sm" onClick={()=>save([])}><Trash2 size={14}/>Limpar</Button></div><p className="text-xs text-muted-foreground">Entre ou crie sua conta para conferir o carrinho, o frete e os vouchers. A seleção não reserva estoque.</p><Button onClick={()=>{try{sessionStorage.setItem(PUBLIC_CART_KEY,JSON.stringify({items,requestKey:crypto.randomUUID()}));router.push(commerceLoginHref('/painel/loja?resume=cart'));}catch{toast.error('Permita o armazenamento do navegador para continuar com sua seleção.');}}}>Entrar ou criar conta para comprar</Button></section>}</div>;
}
