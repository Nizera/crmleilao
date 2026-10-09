import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Catálogo fixo: 4 cores x 20 jogadores = 80 SKUs                           */
/* -------------------------------------------------------------------------- */

export const STICKER_COLORS = ["roxa", "bronze", "prata", "dourada"] as const;

export type StickerColor = (typeof STICKER_COLORS)[number];

export const COLOR_LABELS: Record<StickerColor, string> = {
  roxa: "Roxa",
  bronze: "Bronze",
  prata: "Prata",
  dourada: "Dourada",
};

/** Classe Tailwind do chip de cor (usada na matriz e nos chips do lote). */
export const COLOR_DOT: Record<StickerColor, string> = {
  roxa: "bg-violet-500",
  bronze: "bg-amber-700",
  prata: "bg-slate-400",
  dourada: "bg-yellow-400",
};

export const colorLabel = (value: string): string =>
  COLOR_LABELS[value as StickerColor] ?? value;

export const isStickerColor = (value: string): value is StickerColor =>
  (STICKER_COLORS as readonly string[]).includes(value);

/* -------------------------------------------------------------------------- */
/*  Tipos                                                                     */
/* -------------------------------------------------------------------------- */

export type Player = {
  id: string;
  name: string;
  country: string;
  sort_order: number;
};

export type StockItem = {
  id: string;
  player_id: string;
  color: StickerColor;
  qty_on_hand: number;
  updated_at: string;
  player: Player | null;
};

export type StockMovement = {
  id: string;
  stock_item_id: string;
  delta: number;
  kind: StockMoveKind;
  lot_id: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
  stock_item: {
    color: StickerColor;
    player: { name: string } | null;
  } | null;
};

export const STOCK_MOVE_KINDS = [
  "lot_pick",
  "lot_return",
  "manual_adjust",
] as const;

export type StockMoveKind = (typeof STOCK_MOVE_KINDS)[number];

export const STOCK_MOVE_LABELS: Record<StockMoveKind, string> = {
  lot_pick: "Saída — lote",
  lot_return: "Entrada — devolução",
  manual_adjust: "Ajuste manual",
};

/** Uma linha da composição do lote (o que o admin escolheu). */
export type LotItemPick = {
  stock_item_id: string;
  qty: number;
};

/** Linha como guardada no banco, já com jogador/cor espelhados. */
export type LotItemRow = {
  lot_id: string;
  stock_item_id: string;
  player_id: string;
  color: StickerColor;
  qty: number;
  applied: boolean;
  player: { id: string; name: string; country: string } | null;
};

export const pickSchema = z.object({
  stock_item_id: z.string().trim().min(1, "Item de estoque inválido"),
  qty: z
    .number()
    .int("Quantidade deve ser um número inteiro")
    .min(1, "Quantidade deve ser pelo menos 1")
    .max(999, "Quantidade máxima por item: 999"),
});

export const lotItemsSchema = z.array(pickSchema).max(200);

/** Converte o JSON do hidden input do formulário em itens validados. */
export function parseLotItems(raw: unknown): LotItemPick[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Lista de figurinhas inválida.");
  }

  const result = lotItemsSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "Figurinhas inválidas.");
  }

  // Une repetições do mesmo SKU, que o formulário já deve impedir.
  const merged = new Map<string, number>();
  for (const pick of result.data) {
    merged.set(pick.stock_item_id, (merged.get(pick.stock_item_id) ?? 0) + pick.qty);
  }

  return [...merged.entries()].map(([stock_item_id, qty]) => ({ stock_item_id, qty }));
}

/** Um lote sem itens continua válido (lotes anteriores à F2). */
export const emptyItemsJson = "[]";
