export type VoucherTemplate={id:string;name:string;coins_cost:number|null;discount_cash:number|null;min_purchase:number;validity_days:number;eligible_product_ids:string[];max_redemptions:number|null;max_per_customer:number;active:boolean;updated_at:string};
export type CustomerVoucher={id:string;name:string;customer_id?:string;template_id:string;coins_paid:number;discount_cash:number;min_purchase:number;eligible_product_ids:string[];expires_at:string;status:'available'|'reserved'|'used';order_id:string|null;created_at:string};
export function voucherDiscount(voucher:CustomerVoucher|undefined,items:{reward_id:string;quantity:number;expected_cash:number}[],now=Date.now()) {
 if(!voucher || Number(voucher.discount_cash)>20 || voucher.status!=='available' || Date.parse(voucher.expires_at)<=now)return 0;
 const eligible=items.filter(item=>!voucher.eligible_product_ids.length||voucher.eligible_product_ids.includes(item.reward_id)).reduce((sum,item)=>sum+Math.round(item.expected_cash*100)*item.quantity,0);
 if(!eligible || eligible<Math.round(voucher.min_purchase*100))return 0;
 return Math.min(Math.round(voucher.discount_cash*100),eligible);
}
