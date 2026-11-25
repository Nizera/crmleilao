import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicStorefront } from "@/components/client/public-storefront";
import { createAdminClient } from "@/lib/supabase/admin";
import { catalogFiltersFrom, storeProductImageUrl } from "@/lib/store-presentation";
import { getStoreShippingPreview } from "@/lib/store-shipping-preview-server";
import type { StoreProduct } from "@/lib/store";

type Props = { params: Promise<{ id: string }> };

const getProduct = cache(async (id: string): Promise<StoreProduct | null> => {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return null;
  const db = createAdminClient();
  const [product, settings] = await Promise.all([
    db.from("loyalty_rewards")
      .select("id,name,description,delivery_kind,points_cost,stock,image_path,image_paths,sku,category,cash_price")
      .eq("id", id).eq("active", true).eq("archived", false)
      .is("mixed_cash_price", null).is("mixed_points_cost", null)
      .or("and(cash_price.gt.0,points_cost.is.null),and(points_cost.gt.0,cash_price.is.null)")
      .maybeSingle(),
    db.from("loyalty_settings").select("active").eq("id", true).maybeSingle(),
  ]);
  if (product.error || settings.error) throw new Error("Falha ao carregar produto da loja");
  return settings.data?.active ? product.data as StoreProduct | null : null;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);
  if (!product) return { title: "Produto indisponível" };
  const description = product.description?.trim() || "Confira este produto na Loja dos Caras.";
  const path = `/loja/produto/${product.id}`;
  const image = product.image_path ?? product.image_paths?.[0];
  return {
    title: product.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: product.name,
      description,
      url: path,
      images: image ? [storeProductImageUrl(image)] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  const [product, shippingDate] = await Promise.all([getProduct(id), getStoreShippingPreview()]);
  if (!product) notFound();
  return (
    <div className="store-page grid min-w-0 gap-5">
      <Link href="/loja" className="w-fit text-sm underline">Voltar à loja</Link>
      <PublicStorefront
        detail={product}
        catalog={{ items: [product], categories: [], total: 1, page: 1, pages: 1, size: 1 }}
        filters={catalogFiltersFrom({})}
        shippingDate={shippingDate}
      />
    </div>
  );
}
