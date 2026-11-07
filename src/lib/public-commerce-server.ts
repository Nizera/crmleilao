import "server-only";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { safeCommerceNext } from "@/lib/commerce-access";
/** Redirect members to their authenticated equivalent; anonymous visitors stay public. */
export async function redirectCommerceMember(destination: string) {
 const db=await createClient();const {data:{user}}=await db.auth.getUser();
 if(!user)return;
 const {data}=await db.from('customers').select('id').eq('auth_user_id',user.id).maybeSingle();
 if(data)redirect(safeCommerceNext(destination));
}
