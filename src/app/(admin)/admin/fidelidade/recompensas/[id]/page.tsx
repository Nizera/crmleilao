import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { getProductEditorData } from "@/lib/store-admin-server";
import { RewardForm } from "@/components/admin/loyalty/reward-form";
import { LoyaltyAdminShell } from "@/components/admin/loyalty/loyalty-admin-shell";
export const metadata={title:"Editar produto"};
export default async function EditStoreProductPage({params}:{params:Promise<{id:string}>}){
  const {profile}=await requireAdmin();const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
  const data=await getProductEditorData(id);
  if(!data.ready)return <LoyaltyAdminShell active="recompensas"><p className="rounded-xl border p-5 text-sm">Aplique as migrations 0024 e 0025 para liberar a edição de produtos.</p></LoyaltyAdminShell>;
  if(!data.product)notFound();
  return <LoyaltyAdminShell active="recompensas" hideHeader><RewardForm key={`${data.product.id}-${data.product.updated_at}`} reward={data.product} canEdit={profile.role!=="viewer"} categories={data.categories} /></LoyaltyAdminShell>;
}
