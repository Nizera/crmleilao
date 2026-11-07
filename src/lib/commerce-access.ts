import { z } from "zod";
/** Only internal customer-commerce destinations; never accept an external redirect. */
export function safeCommerceNext(value: unknown): string {
 if (typeof value !== "string" || value.length > 1800 || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return "/painel";
 try {
  const url=new URL(value,"https://app.invalid");
  if(url.origin!=="https://app.invalid" || !(/^\/painel\/(loja|rifas)$/.test(url.pathname)||(/^\/painel\/rifas\/[^/]+$/.test(url.pathname)&&z.uuid().safeParse(url.pathname.split('/').at(-1)).success)))return "/painel";
  const params=new URLSearchParams();for(const key of ['tab','q','category','mode','sort','min','max','available','page','from','resume']){const item=url.searchParams.get(key);if(item!==null)params.set(key,item.slice(0,100));}
  return url.pathname+(params.size?'?'+params:'');
 }catch{return "/painel";}
}
export const commerceLoginHref=(next:string)=>`/painel/login?next=${encodeURIComponent(safeCommerceNext(next))}`;
export const PUBLIC_CART_KEY='ocdl-public-cart-v1';
export const raffleIntentKey=(id:string)=>`ocdl-public-raffle-v1:${id}`;
export const raffleIntentSchema=z.object({automatic:z.boolean(),quantity:z.number().int().min(1).max(1000),numbers:z.array(z.number().int().min(0).max(9999)).max(1000)});
