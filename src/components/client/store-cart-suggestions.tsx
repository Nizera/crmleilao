"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { getStoreSuggestions } from "@/app/actions/store-recommendations";
import { Button } from "@/components/ui/button";
import { priceLabel, productPrices, type CartLine, type PriceMode, type StoreProduct } from "@/lib/store";
import { storeProductImageUrl } from "@/lib/store-presentation";

export function StoreCartSuggestions({ items, onAdd, disabled = false }: {
  items: readonly CartLine[];
  onAdd: (product: StoreProduct, mode: PriceMode) => void;
  disabled?: boolean;
}) {
  const ids = [...new Set(items.map(item => item.reward_id))].join(",");
  const mode = items[0]?.mode;
  const key = mode + ":" + ids;
  const [snapshot, setSnapshot] = useState<{ key: string; products: StoreProduct[] } | null>(null);
  useEffect(() => {
    if (!ids || (mode !== "cash" && mode !== "coins")) return;
    let disposed = false;
    getStoreSuggestions({ ids: ids.split(","), mode }).then(products => {
      if (!disposed) setSnapshot({ key, products });
    }).catch(() => {
      if (!disposed) setSnapshot({ key, products: [] });
    });
    return () => { disposed = true; };
  }, [ids, key, mode]);
  const suggestions = snapshot?.key === key ? snapshot.products : [];
  if (!suggestions.length) return null;
  return <section aria-label="Complete sua coleção" className="grid gap-2 rounded-xl border p-3">
    <h3 className="text-sm font-semibold">Complete sua coleção</h3>
    <ul className="grid gap-2">
      {suggestions.map(product => {
        const price = productPrices(product).find(option => option.mode === mode);
        if (!price) return null;
        return <li key={product.id} className="flex items-center gap-2">
          {product.image_path && <Image src={storeProductImageUrl(product.image_path)} alt="" width={36} height={36}
            className="size-9 shrink-0 rounded bg-white object-contain" />}
          <div className="min-w-0 flex-1 text-xs">
            <p className="break-words font-medium">{product.name}</p>
            <p className="text-muted-foreground">{priceLabel(price.cash, price.coins)}</p>
          </div>
          <Button type="button" size="sm" variant="outline" disabled={disabled}
            aria-label={"Adicionar " + product.name} onClick={() => onAdd(product, price.mode)}>Adicionar</Button>
        </li>;
      })}
    </ul>
  </section>;
}
