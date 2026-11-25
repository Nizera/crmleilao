import { productPrices, type StoreProduct } from "@/lib/store";

const cardSelections: Readonly<Record<string, string>> = {
  "CARD-ALEJANDRO-GARNACHO": "ARG",
  "CARD-ANGEL-CORREA": "ARG",
  "CARD-ALISSON-BECKER": "BRA",
  "CARD-RODRYGO": "BRA",
  "CARD-AO-TANAKA": "JPN",
  "CARD-DAICHI-KAMADA": "JPN",
  "CARD-MAKOTO-HASEBE": "JPN",
  "CARD-BRUNO-FERNANDES": "POR",
  "CARD-JOAO-FELIX": "POR",
  "CARD-MARCO-VERRATTI": "ITA",
  "CARD-NICOLO-BARELLA": "ITA",
};

function legendPlayer(sku: string) {
  return /^(LEG26-[A-Z0-9-]+)-(BRONZE|PRATA|OURO|LILAS)$/.exec(sku)?.[1];
}

const copaComplements: Readonly<Record<string, readonly string[]>> = {
  "COPA26-ALB-DOURADO-10": ["COPA26-PAC-050", "COPA26-PAC-100", "COPA26-PASTA-BRA-ROXA"],
  "COPA26-ALB-PRATA-10": ["COPA26-PAC-050", "COPA26-PAC-100", "COPA26-PASTA-BRA-ROXA"],
  "COPA26-DISP-LAC": ["COPA26-ALB-DOURADO-10", "COPA26-ALB-PRATA-10", "COPA26-PASTA-BRA-ROXA"],
  "COPA26-PAC-050": ["COPA26-ALB-PRATA-10", "COPA26-ALB-DOURADO-10", "COPA26-PASTA-BRA-ROXA"],
  "COPA26-PAC-100": ["COPA26-ALB-PRATA-10", "COPA26-ALB-DOURADO-10", "COPA26-PASTA-BRA-ROXA"],
  "COPA26-PAC-BUGADO": ["COPA26-ALB-PRATA-10", "COPA26-ALB-DOURADO-10", "COPA26-PASTA-BRA-ROXA"],
  "COPA26-PASTA-BRA-ROXA": ["COPA26-ALB-PRATA-10", "COPA26-ALB-DOURADO-10", "COPA26-PAC-050"],
};

export function relatedStoreSkus(sku: string): readonly string[] {
  if (Object.hasOwn(copaComplements, sku)) return copaComplements[sku];
  if (Object.hasOwn(cardSelections, sku)) {
    return Object.keys(cardSelections).filter(candidate =>
      candidate !== sku && cardSelections[candidate] === cardSelections[sku]);
  }
  const player = legendPlayer(sku);
  return player ? ["OURO", "LILAS", "PRATA", "BRONZE"].map(color => player + "-" + color).filter(candidate => candidate !== sku) : [];
}

export function selectStoreSuggestions(
  anchors: readonly StoreProduct[],
  candidates: readonly StoreProduct[],
  cartIds: readonly string[],
  mode: "cash" | "coins",
) {
  const excluded = new Set(cartIds);
  const bySku = new Map(candidates.filter(product =>
    product.sku && !excluded.has(product.id) && (product.stock === null || product.stock > 0) &&
    productPrices(product).some(price => price.mode === mode),
  ).map(product => [product.sku, product]));
  const result: StoreProduct[] = [];
  for (const anchor of anchors) {
    for (const sku of relatedStoreSkus(anchor.sku ?? "")) {
      const candidate = bySku.get(sku);
      if (!candidate) continue;
      bySku.delete(sku);
      result.push(candidate);
      if (result.length === 3) return result;
    }
  }
  return result;
}
