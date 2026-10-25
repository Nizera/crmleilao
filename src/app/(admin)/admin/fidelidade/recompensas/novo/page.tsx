import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getProductEditorData } from "@/lib/store-admin-server";
import { CATALOG_PATH } from "@/lib/store-admin";
import { RewardForm } from "@/components/admin/loyalty/reward-form";
import { LoyaltyAdminShell } from "@/components/admin/loyalty/loyalty-admin-shell";
export const metadata={title:"Novo produto"};
export default async function NewStoreProductPage(){
  const {profile}=await requireAdmin();if(profile.role==="viewer")redirect(CATALOG_PATH);
  const data=await getProductEditorData();
  return <LoyaltyAdminShell active="recompensas" hideHeader>{data.ready?<RewardForm canEdit categories={data.categories} />:<p className="rounded-xl border p-5 text-sm">Aplique as migrations 0024 e 0025 para liberar o cadastro de produtos.</p>}</LoyaltyAdminShell>;
}
