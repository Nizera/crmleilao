import { requireAdmin } from '@/lib/dal';
import { createClient } from '@/lib/supabase/server';
import { LoyaltyAdminShell } from '@/components/admin/loyalty/loyalty-admin-shell';
import { StoreBannerForm } from '@/components/admin/loyalty/store-banner-form';
import type { StoreBanner } from '@/lib/store-presentation';
export const metadata={title:'Banner da loja'};
export const instant=false;
export default async function StoreBannersPage(){
 const {profile}=await requireAdmin();const db=await createClient();const {data,error}=await db.from('store_banner').select('*').eq('id',true).single();
 return <LoyaltyAdminShell active="banners">{error||!data?<p role="alert">Aplique a migration 0038 para configurar o banner da loja.</p>:<StoreBannerForm key={data.updated_at} banner={data as StoreBanner} canEdit={profile.role!=='viewer'}/>}</LoyaltyAdminShell>;
}
