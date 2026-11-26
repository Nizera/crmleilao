import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LoyaltyAdminShell } from "@/components/admin/loyalty/loyalty-admin-shell";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/dal";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Cupons da loja" };
export const instant = false;
const path = "/admin/fidelidade/cupons";

async function changeCouponStatus(form: FormData) {
  "use server";
  const { profile } = await requireAdmin();
  const active = form.get("active");
  if (profile.role === "viewer" || (active !== "true" && active !== "false")) return;
  const { error } = await createAdminClient().from("store_coupons")
    .update({ active: active === "true" }).eq("code", "BEMVINDO10");
  revalidatePath(path);
  redirect(path + (error ? "?failed=1" : "?saved=1"));
}

export default async function CouponsPage({
  searchParams,
}: { searchParams: Promise<{ failed?: string; saved?: string }> }) {
  const { profile } = await requireAdmin();
  const db = createAdminClient();
  const [params, couponResult, usage] = await Promise.all([
    searchParams,
    db.from("store_coupons").select("code,percent_off,active").eq("code", "BEMVINDO10").single(),
    db.from("store_orders").select("id", { count: "exact", head: true })
      .eq("coupon_code", "BEMVINDO10").not("paid_at", "is", null),
  ]);
  const coupon = couponResult.data;

  return <LoyaltyAdminShell active="cupons" saved={params.saved === "1"}
    error={params.failed === "1" ? "Não foi possível atualizar o cupom." : undefined}>
    {coupon ? <section className="grid gap-3 rounded-xl border bg-card p-4">
      <h2 className="text-xl font-semibold">{coupon.code}</h2>
      <p>{coupon.percent_off}% de desconto na primeira compra · sem valor mínimo</p>
      <p className="text-sm text-muted-foreground">{coupon.active ? "Ativo" : "Pausado"} · {usage.error ? "Usos indisponíveis" : `${usage.count ?? 0} pedidos com pagamento confirmado`}</p>
      {profile.role !== "viewer" && <form action={changeCouponStatus}>
        <input type="hidden" name="active" value={String(!coupon.active)} />
        <Button type="submit" variant="outline">{coupon.active ? "Pausar cupom" : "Ativar cupom"}</Button>
      </form>}
    </section> : <p>Não foi possível carregar o cupom da loja.</p>}
  </LoyaltyAdminShell>;
}
