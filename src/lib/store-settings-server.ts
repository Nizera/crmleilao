import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {headers} from 'next/headers';
export async function isLocalStorePilot(customerId:string):Promise<boolean>{
 if(process.env.NODE_ENV!=='development'||process.env.VERCEL||!process.env.STORE_LOCAL_TEST_CUSTOMER_ID||process.env.STORE_LOCAL_TEST_CUSTOMER_ID!==customerId)return false;
 const host=(await headers()).get('host')??'';
 return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
}
export async function storePurchasesEnabled(customerId?:string):Promise<boolean>{
 if(customerId && await isLocalStorePilot(customerId))return true;
 const db=await createClient();const {data,error}=await db.from('store_commerce_settings').select('purchases_enabled').eq('id',true).single();
 return !error && data?.purchases_enabled===true;
}
