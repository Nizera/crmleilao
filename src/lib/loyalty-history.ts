import type { StoreOrder,StoreProduct } from './store';
export const coinKinds={earned:'Caracoins por lote pago',spent:'Compra ou resgate',reversal:'Estorno de lote',adjustment:'Ajuste ou devolução'} as const;
export type HistoryFilters={q:string;kind:string;from:string;to:string;page:number;size:number};
export type CoinHistory={total:number;credits:number;debits:number;page:number;pages:number;size:number;items:{id:string;points:number;kind:keyof typeof coinKinds;note:string|null;created_at:string;lot_value:number|null;earn_rate:number|null;customer_name:string|null;customer_phone:string|null}[]};
export type CustomerOrder=StoreOrder & {source:'store'|'legacy';legacy_status:string|null};
export type CustomerOrders={items:CustomerOrder[];total:number;page:number;pages:number;size:number};
export type CustomerCatalog={items:StoreProduct[];categories:string[];total:number;page:number;pages:number;size:number};
export const first=(v:string|string[]|undefined)=>(Array.isArray(v)?v[0]:v)??'';
export const validDay=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
export function historyFilters(params:Record<string,string|string[]|undefined>):HistoryFilters {
 const get=(k:string)=>first(params[k]); const from=validDay(get('from'))?get('from'):'';const to=validDay(get('to'))?get('to'):'';
 return {q:get('q').trim().slice(0,100),kind:Object.hasOwn(coinKinds,get('kind'))?get('kind'):'',from,to:from&&to&&to<from?from:to,
 page:Math.max(1,Math.min(1000000,Math.trunc(Number(get('page')))||1)),size:[10,20,50].includes(Number(get('size')))?Number(get('size')):20};
}
export function pageHref(path:string,params:Record<string,string|string[]|undefined>,page:number) {
 const p=new URLSearchParams();for(const [k,v] of Object.entries(params)){if(v&& !['erro','salvo','page'].includes(k))p.set(k,first(v));}if(page>1)p.set('page',String(page));
 return path+(p.size?`?${p}`:'');
}
export const coinDate=(s:string)=>new Date(s).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'});
